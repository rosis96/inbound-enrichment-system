import {
  dependencyOrder,
  effectiveRules,
  GeneratedVariablesOutput,
  isMailMergeToken,
  parsePlaceholders,
  PersonalisationPlan,
  variableDependencies,
  type AiVariable,
  type ClientSettings,
  type EffectiveRules,
  type GeneratedVariable,
  type Placeholder,
  type PlanDetail,
  type ValidationCheck,
  type VariableAttempt,
  type VariableResult,
} from "@enrich/shared";
import { mentionsTracking, wordCount } from "./personalise";

/** Bump when the planner or writer prompts change meaningfully; stored with each result. */
export const PERSONALISATION_ENGINE_VERSION = 3;

/** Correction rounds after the first attempt, reusing the same research. */
export const MAX_CORRECTIONS = 2;

const PLAN_CRAWL_CHARS = 12_000;

// ---------- inputs ----------

export interface WriterContext {
  copy: ClientSettings["copy"];
  contact: { firstName: string | null; lastName: string | null; title: string | null; email?: string | null };
  company: { domain: string; name: string | null; industry: string | null; country: string | null };
  /** Website text from the crawler (`## title` / `Source: url` sections), or null when the crawl failed. */
  crawlText: string | null;
  /** Topic from the pages they visited; steers relevance, never mentioned. */
  intentTopic?: string | null;
}

export type LlmJsonResult =
  | { ok: true; json: unknown; model: string; costUsd: number }
  | { ok: false; code: string; transient: boolean; detail?: unknown };

/** One JSON-mode completion. The caller binds the API key, model and prices. */
export type LlmJsonCall = (prompt: string) => Promise<LlmJsonResult>;

/** Raised for 429 / 5xx / network errors so a queued job can retry. */
export class LlmTransientError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: unknown,
  ) {
    super(`LLM call failed: ${code}`);
    this.name = "LlmTransientError";
  }
}

// ---------- crawl text ----------

export interface CrawlSection {
  url: string | null;
  title: string;
  text: string;
}

/** Splits crawler text back into pages; older crawls have no `Source:` line, so their URL is null. */
export function crawlSections(crawlText: string | null): CrawlSection[] {
  if (!crawlText) return [];
  return crawlText
    .split(/^## /m)
    .filter((part) => part.trim())
    .map((part) => {
      const [title = "", ...lines] = part.split("\n");
      const source = lines[0]?.match(/^Source:\s*(\S+)/);
      return { url: source ? source[1]! : null, title: title.trim(), text: (source ? lines.slice(1) : lines).join("\n") };
    });
}

/** Lowercase letters and digits only, so quotes match across punctuation, quote styles and spacing. */
export function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------- plan ----------

function bulletList(items: string[], empty = "none given"): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function senderBlock(copy: ClientSettings["copy"]): string {
  return `Description: ${copy.companyDescription || "not described"}
Offer: ${copy.offer || "not described"}
Services they can deliver:
${bulletList(copy.services, "not listed; infer only from the description")}
Approved proof (case studies, research and figures they may cite):
${bulletList(copy.proof, "none; do not cite any results")}`;
}

export function buildPlanPrompt(context: WriterContext): string {
  const { company, copy } = context;
  const name = company.name || company.domain;
  const website = context.crawlText
    ? `Website text (each page starts with "## title" and a "Source:" URL):
"""
${context.crawlText.slice(0, PLAN_CRAWL_CHARS)}
"""`
    : `No website text is available. "details" must be [] and the description may only restate the name and industry.`;

  return `You are a B2B research analyst preparing personalisation for cold outreach from ${copy.senderName || "our client"} to ${name}.

THE SENDER (our client), approved context:
${senderBlock(copy)}

THE PROSPECT
Name: ${name}
Website: ${company.domain}
Industry from visitor data (may be rough): ${company.industry || "unknown"}
Country: ${company.country || "unknown"}
${website}

Build a personalisation plan. Keep three things apart:
- Confirmed facts: only what the website text states.
- Strategic interpretation: plausible challenges and benefits that the sender's services address. Possibilities, not facts about the prospect.
- Unknowns: what public evidence cannot establish (budgets, buying intent, supplier satisfaction, procurement authority, undisclosed pipeline).

Return JSON with:
- description: 1-2 sentences on what the company actually does (facts only)
- category: the kind of company as a plural noun phrase for outreach, e.g. "mixed-use real estate developers". Relevant to the sender's services and accurate, but not unnecessarily narrow: no locations, superlatives or niche qualifiers. For a diversified company pick the category closest to what the sender sells. Do not invent specialisations.
- industry: the broader industry, e.g. "mixed-use real estate"
- activities: main business activities (up to 6)
- details: up to 8 specific, distinctive facts for personalisation, best first: named projects or developments, flagship products or services, public achievements, named partnerships, published case studies, distinctive capabilities, recent announcements. Each is {"id": "D1", "kind": "project" | "product" | "achievement" | "partnership" | "case_study" | "capability" | "announcement", "name": the short name as written on the site, "detail": what it is and why it is notable (facts only), "evidence": an exact quote of under 25 words copied from the website text, "sourceUrl": the Source URL of that page}. Never include anything that is not in the website text.
- primaryDetailId and alternativeDetailId: ids of the best and a different second-best detail, or null
- relevantServices: 2-4 of the sender's services, copied from the list above, that fit this prospect
- challenges: 2-4 challenges companies like this commonly face that those services address (possible, not confirmed)
- benefits: 3-4 potential benefits of the sender's work for them
- longTermOutcomes: 1-3 long-term strategic outcomes
- proof: up to 2 items copied from the approved proof that are most relevant, or []
- unknowns: important things the evidence cannot establish`;
}

/** Plan with no research: used when the crawl or the planner failed, so the writer stays general. */
export function fallbackPlan(context: WriterContext): PersonalisationPlan {
  return PersonalisationPlan.parse({
    description: `${context.company.name || context.company.domain}${context.company.industry ? `, ${context.company.industry}` : ""}`,
    industry: context.company.industry ?? "",
    unknowns: ["website research unavailable"],
  });
}

export interface PlanCheck {
  /** Details whose evidence or name was not found in the website text; removed from the plan. */
  unverifiedDetails: { name: string; evidence: string }[];
  /** Services the planner chose that are not in the client's list; removed. */
  droppedServices: string[];
  droppedProof: string[];
}

const listMatch = (value: string, allowed: string[]) => {
  const v = normaliseForMatch(value);
  return allowed.find((a) => {
    const n = normaliseForMatch(a);
    return n === v || n.includes(v) || v.includes(n);
  });
};

/**
 * Parses the planner's reply and keeps only what can be checked: details whose evidence or name appears
 * in the crawled text (with the page they came from), and services and proof from the client's lists.
 */
type Loose = Record<string, unknown>;
const isLoose = (value: unknown): value is Loose => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A string from whatever the model put there: numbers are kept, null and objects become "". */
function looseText(value: unknown, ...keys: string[]): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isLoose(value)) for (const key of keys) if (typeof value[key] === "string") return value[key];
  return "";
}

/** A list of strings from a list, a single string or a list of objects with a text-like field. */
function looseList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return items.map((item) => looseText(item, "text", "name", "title", "description", "value")).filter((item) => item.trim() !== "");
}

/**
 * Coerces the planner's reply into the plan's shape: models sometimes wrap it ({"plan": {...}}), send
 * null for empty fields, numbers for ids or objects where a phrase was asked for.
 */
export function normalisePlanReply(json: unknown): Loose | null {
  let root = isLoose(json) ? json : null;
  if (!root) return null;
  const keys = Object.keys(root);
  if (keys.length === 1 && isLoose(root[keys[0]!]) && !("category" in root) && !("details" in root)) root = root[keys[0]!] as Loose;

  const id = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : null);
  const details = (Array.isArray(root.details) ? root.details : [])
    .filter(isLoose)
    .map((d, i) => ({
      id: id(d.id) ?? `D${i + 1}`,
      kind: looseText(d.kind ?? d.type).toLowerCase().replace(/[\s-]+/g, "_"),
      name: looseText(d.name ?? d.title),
      detail: looseText(d.detail ?? d.description ?? d.why),
      evidence: looseText(d.evidence ?? d.quote),
      sourceUrl: typeof d.sourceUrl === "string" ? d.sourceUrl : typeof d.source === "string" ? d.source : null,
      verified: false,
    }))
    .filter((d) => d.name.trim() !== "")
    .slice(0, 10);

  return {
    description: looseText(root.description),
    category: looseText(root.category),
    industry: looseText(root.industry),
    activities: looseList(root.activities),
    details,
    primaryDetailId: id(root.primaryDetailId),
    alternativeDetailId: id(root.alternativeDetailId),
    relevantServices: looseList(root.relevantServices),
    challenges: looseList(root.challenges),
    benefits: looseList(root.benefits),
    longTermOutcomes: looseList(root.longTermOutcomes),
    proof: looseList(root.proof),
    unknowns: looseList(root.unknowns),
  };
}

export function verifyPlan(json: unknown, context: WriterContext): { plan: PersonalisationPlan; check: PlanCheck } | null {
  const raw = normalisePlanReply(json);
  if (!raw) return null;
  const parsed = PersonalisationPlan.safeParse(raw);
  if (!parsed.success) return null;
  const plan = parsed.data;
  const check: PlanCheck = { unverifiedDetails: [], droppedServices: [], droppedProof: [] };

  const sections = crawlSections(context.crawlText).map((s) => ({ ...s, normal: normaliseForMatch(`${s.title}\n${s.text}`) }));
  const corpus = sections.map((s) => s.normal).join(" ");
  const pageUrls = new Set(sections.map((s) => s.url).filter(Boolean));
  const found = (text: string) => {
    const n = normaliseForMatch(text);
    return n.length >= 3 && corpus.includes(n);
  };

  const details: PlanDetail[] = [];
  for (const detail of plan.details) {
    const evidenceOk = detail.evidence ? found(detail.evidence) : false;
    const nameOk = found(detail.name);
    if (!evidenceOk && !nameOk) {
      check.unverifiedDetails.push({ name: detail.name, evidence: detail.evidence });
      continue;
    }
    const needle = normaliseForMatch(evidenceOk ? detail.evidence : detail.name);
    const page = sections.find((s) => s.normal.includes(needle));
    const sourceUrl = detail.sourceUrl && pageUrls.has(detail.sourceUrl) ? detail.sourceUrl : (page?.url ?? `https://${context.company.domain}/`);
    details.push({ ...detail, verified: true, sourceUrl });
  }
  plan.details = details;
  const ids = new Set(details.map((d) => d.id));
  if (plan.primaryDetailId && !ids.has(plan.primaryDetailId)) plan.primaryDetailId = details[0]?.id ?? null;
  if (!plan.primaryDetailId && details[0]) plan.primaryDetailId = details[0].id;
  if (plan.alternativeDetailId && (!ids.has(plan.alternativeDetailId) || plan.alternativeDetailId === plan.primaryDetailId)) {
    plan.alternativeDetailId = details.find((d) => d.id !== plan.primaryDetailId)?.id ?? null;
  }

  const { services, proof } = context.copy;
  if (services.length > 0) {
    const kept: string[] = [];
    for (const service of plan.relevantServices) {
      const match = listMatch(service, services);
      if (match) kept.push(match);
      else check.droppedServices.push(service);
    }
    plan.relevantServices = [...new Set(kept)];
  }
  const keptProof: string[] = [];
  for (const item of plan.proof) {
    const match = listMatch(item, proof);
    if (match) keptProof.push(match);
    else check.droppedProof.push(item);
  }
  plan.proof = [...new Set(keptProof)];
  return { plan, check };
}

export interface PlanResult {
  plan: PersonalisationPlan;
  check: PlanCheck | null;
  /** Why the fallback plan was used, if it was. */
  error: string | null;
  /** The planner's reply when it could not be used, for debugging. */
  raw?: unknown;
  model: string | null;
  costUsd: number;
}

/** Researches the prospect once for all variables. Throws LlmTransientError on retryable failures. */
export async function buildPlan(context: WriterContext, llm: LlmJsonCall): Promise<PlanResult> {
  const reply = await llm(buildPlanPrompt(context));
  if (!reply.ok) {
    if (reply.transient) throw new LlmTransientError(reply.code, reply.detail);
    return { plan: fallbackPlan(context), check: null, error: reply.code, model: null, costUsd: 0 };
  }
  const verified = verifyPlan(reply.json, context);
  if (!verified) {
    return { plan: fallbackPlan(context), check: null, error: "plan reply did not match the expected shape", raw: reply.json, model: reply.model, costUsd: reply.costUsd };
  }
  return { plan: verified.plan, check: verified.check, error: null, model: reply.model, costUsd: reply.costUsd };
}

// ---------- writer ----------

/** Values for `data` placeholders from the lead; mail-merge fields are left for Instantly. */
export function dataValues(context: WriterContext): Record<string, string | null> {
  const { contact, company } = context;
  const full = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    fullName: full || null,
    email: contact.email ?? null,
    companyName: company.name,
    website: `https://${company.domain}`,
    domain: company.domain,
    jobTitle: contact.title,
    country: company.country,
  };
}

function rulesList(rules: EffectiveRules): string[] {
  const lines: string[] = [];
  if (rules.sentences) lines.push(`exactly ${rules.sentences} sentence${rules.sentences === 1 ? "" : "s"}`);
  if (rules.startsWith) lines.push(`starts with ${rules.startsWith.map((o) => `"${o}"`).join(" or ")}`);
  for (const s of rules.sentenceStarts) lines.push(`sentence ${s.sentence} starts with "${s.text}"`);
  lines.push(`${rules.minWords}-${rules.maxWords} words`);
  if (rules.maxChars) lines.push(`at most ${rules.maxChars} characters`);
  if (rules.noCta) lines.push("no call to action and no question");
  return lines;
}

function breakRules(variable: AiVariable): string[] {
  const splits = splitMarkerCount(variable.instructions);
  if (splits === 0) return [];
  return [
    `a paragraph break (a blank line, "\\n\\n" in the JSON string) exactly where the instructions say ||split||: ${splits} break${splits === 1 ? "" : "s"} in total; never write "||split||" itself`,
  ];
}

function placeholderLine(p: Placeholder, values: Record<string, string | null>): string {
  if (p.kind === "variable") {
    return `- ${p.raw}: the already written ${p.ref} (shown above); continue or reference its exact idea instead of pasting it unless the instructions say to`;
  }
  if (p.kind === "data") {
    if (p.mailMerge) return `- ${p.raw}: keep exactly as ${p.raw} (filled when the email is sent)`;
    const value = values[p.ref!]?.trim() || p.fallback;
    return value ? `- ${p.raw}: use "${value}"` : `- ${p.raw}: unknown for this lead; rewrite that part naturally without it`;
  }
  return `- ${p.raw}: a description of what to write here; resolve it from the research plan and the sender's context`;
}

function planBlock(plan: PersonalisationPlan): string {
  const details =
    plan.details.length > 0
      ? plan.details.map((d) => `  [${d.id}] (${d.kind}) ${d.name}: ${d.detail}${d.sourceUrl ? ` Source: ${d.sourceUrl}` : ""}`).join("\n")
      : "  none verified; stay general";
  return `Facts (confirmed by their website):
- Description: ${plan.description || "unknown"}
- Category for outreach: ${plan.category || "unknown"}
- Industry: ${plan.industry || "unknown"}
- Activities: ${plan.activities.join("; ") || "unknown"}
- Specific details (cite by id):
${details}
- Primary detail: ${plan.primaryDetailId ?? "none"}. Alternative detail: ${plan.alternativeDetailId ?? "none"}.
Interpretation (possibilities; never state these as facts about the prospect):
- Relevant sender services: ${plan.relevantServices.join("; ") || "pick from the sender's services"}
- Possible challenges: ${plan.challenges.join("; ") || "none identified"}
- Potential benefits: ${plan.benefits.join("; ") || "none identified"}
- Long-term outcomes: ${plan.longTermOutcomes.join("; ") || "none identified"}
- Relevant approved proof: ${plan.proof.join("; ") || "none"}
Unknown (never claim): ${plan.unknowns.join("; ") || "budgets, intent, procurement"}`;
}

export interface WriterTask {
  variable: AiVariable;
  /** Previous failed attempt to correct, if any. */
  feedback?: VariableAttempt;
}

export interface WriterPromptInput {
  context: WriterContext;
  plan: PersonalisationPlan;
  all: AiVariable[];
  tasks: WriterTask[];
  /** Finished variables of this prospect (dependencies and earlier variables). */
  results: Record<string, VariableResult>;
}

export function buildWriterPrompt(input: WriterPromptInput): string {
  const { context, plan, all, tasks, results } = input;
  const { copy, contact, company } = context;
  const names = all.map((v) => v.name);
  const values = dataValues(context);
  const person = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "unknown name";

  const written = Object.values(results).filter((r) => r.status === "ok" && r.text);
  const writtenBlock =
    written.length > 0
      ? `\nALREADY WRITTEN FOR THIS PROSPECT\n${written
          .map((r) => `- ${r.name}: "${r.text}"${r.detailIds.length ? ` (details used: ${r.detailIds.join(", ")})` : ""}`)
          .join("\n")}\n`
      : "";

  const sections = tasks.map(({ variable, feedback }) => {
    const rules = effectiveRules(variable);
    const placeholders = parsePlaceholders(variable.instructions, names.filter((n) => n !== variable.name));
    const deps = new Set(variableDependencies(variable, all));
    const usedElsewhere = written
      .filter((r) => r.name !== variable.name && !deps.has(r.name))
      .flatMap((r) => r.detailIds.map((id) => `${id} (${r.name})`));
    const parts = [
      `### ${variable.name}`,
      `Instructions:\n"""\n${variable.instructions}\n"""`,
      `Placeholders:\n${placeholders.length > 0 ? placeholders.map((p) => placeholderLine(p, values)).join("\n") : "- none; follow the instructions"}`,
      `Rules (checked automatically):\n${bulletList([...rulesList(rules), ...breakRules(variable)])}`,
    ];
    if (deps.size > 0) parts.push(`Builds on: ${[...deps].join(", ")} (above). Stay consistent with it.`);
    if (variable.examples.length > 0) parts.push(`Good examples (style only; do not copy their facts):\n${bulletList(variable.examples)}`);
    if (usedElsewhere.length > 0) parts.push(`Prefer a different detail than those already used: ${usedElsewhere.join(", ")}.`);
    if (feedback) {
      parts.push(
        `Your previous attempt failed these checks:\n${bulletList(feedback.problems)}\nPrevious text: "${feedback.text}"\nFix only these problems and keep what was fine. Use the same research; do not add new facts.`,
      );
    }
    return parts.join("\n");
  });

  return `You write personalised snippets for a cold email from ${copy.senderName || "the sender"}. Each snippet is inserted into a fixed email template, so it must read naturally on its own.

THE SENDER (approved context; the only source for claims about the sender)
${senderBlock(copy)}
Tone: ${copy.tone}

THE RECIPIENT
${person}, ${contact.title || "unknown role"} at ${company.name || company.domain}
Topic they are likely interested in (never mention it as something they did): ${context.intentTopic || "general"}

RESEARCH PLAN FOR THE PROSPECT
${planBlock(plan)}
${writtenBlock}
WRITE THESE VARIABLES
${sections.join("\n\n")}

GENERAL RULES
- If the instructions contain a template, keep its wording, order and structure exactly; replace only each {{placeholder}} with text that fits the grammar of its sentence. The finished text must contain no {{ }} except mail-merge tokens listed above.
- Fill every placeholder. A placeholder such as {{2-3 challenges}} means write two or three challenges.
- Use a company category that is relevant but not unnecessarily narrow, and only the sender's services that fit this prospect, not all of them.
- State as fact only what is under Facts. Challenges are things the sender can help with, never problems the prospect has admitted.
- Never invent projects, clients, results, numbers or percentages. Numbers may only come from the approved proof or the facts.
- When a placeholder asks for a specific project or achievement and no listed detail fits, write a grounded general phrase and list that placeholder under insufficientEvidence.
- Never mention a website visit, browsing, tracking or how we found them.
- Format each snippet the way it will sit in the email. Subject lines and one- or two-sentence snippets are a single line. A longer snippet of three or more sentences, such as a follow-up, is split into short paragraphs of one to three sentences with a blank line ("\\n\\n") between them. Never break a line inside a sentence. Where the instructions say ||split||, always put a paragraph break there.
- No brackets, emojis or generic flattery. Never use these phrases: ${copy.bannedPhrases.join(", ") || "none"}

Return JSON: {"variables": {"<name>": {"text": "<finished text>", "resolved": {"<placeholder exactly as written>": "<text used for it>"}, "detailIds": ["<ids of details used>"], "insufficientEvidence": ["<placeholders without supporting evidence>"]}}} with every variable above.`;
}

/** Writer reply per variable; tolerates a bare string instead of the object. */
export function parseWriterReply(json: unknown): Record<string, GeneratedVariable> | null {
  const root = json && typeof json === "object" ? (json as { variables?: unknown }) : null;
  if (!root || !root.variables || typeof root.variables !== "object") return null;
  const variables = Object.fromEntries(
    Object.entries(root.variables as Record<string, unknown>).map(([name, value]) => [
      name,
      typeof value === "string" ? { text: value } : Array.isArray(value) ? { text: String(value[0] ?? "") } : value,
    ]),
  );
  const parsed = GeneratedVariablesOutput.safeParse({ variables });
  return parsed.success ? parsed.data.variables : null;
}

/** `||split||` (any number of pipes ≥ 2, any case) in instructions: the text needs a paragraph break there. */
const SPLIT_MARKER = /[ \t]*\|{2,}\s*split\s*\|{2,}[ \t]*/gi;

/** Paragraph breaks the instructions ask for with `||split||`. */
export function splitMarkerCount(instructions: string): number {
  return instructions.match(SPLIT_MARKER)?.length ?? 0;
}

/** Paragraph breaks (blank lines) in a finished text. */
export const paragraphBreaks = (text: string): number => text.match(/\n\s*\n/g)?.length ?? 0;

/**
 * The finished text as it goes into the email: tidied, and a text of three or more sentences that came back
 * as one block is split into paragraphs of two sentences, as a follow-up email would read. Breaks the writer
 * placed itself (or `||split||` asked for) are kept as they are.
 */
export function formatText(text: string): string {
  const tidy = tidyText(text);
  if (tidy.includes("\n")) return tidy;
  const sentences = splitSentences(tidy);
  if (sentences.length < 3) return tidy;
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) paragraphs.push(sentences.slice(i, i + 2).join(" "));
  return paragraphs.join("\n\n");
}

/** Collapses spaces but keeps paragraph breaks, which templates may rely on. A `||split||` the writer copied becomes a break. */
export function tidyText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(SPLIT_MARKER, "\n\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- validation ----------

/** Endings that are never a sentence end when more text follows: titles, "e.g.", initials ("J. Smith"). */
const NOT_AN_END = /(?:(?:^|[\s(])(?:mr|mrs|ms|dr|st|jr|sr|vs|no|e\.g|i\.e)|(?:^|\s)[A-Z])\.$/i;

/** Sentences of a text; ignores dots in abbreviations, initials and numbers. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?]+["'”’)\]]*(?=\s|$)/g)) {
    const end = match.index! + match[0].length;
    const candidate = text.slice(start, end).trim();
    const next = text.slice(end).trimStart();
    if (next !== "" && /^[a-z]/.test(next)) continue;
    if (next !== "" && match[0] === "." && NOT_AN_END.test(candidate)) continue;
    if (candidate) sentences.push(candidate);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

const CTA = /\b(let me know|book (?:a|some) (?:call|meeting|time)|schedule (?:a|some)|hop on a call|jump on a call|open to (?:a|an) (?:call|chat|conversation|meeting)|worth a (?:call|chat|conversation)|are you free|grab (?:a|some) time|calendar link|click here|reply (?:to this|with))\b/i;

/** A sentence where the sender ("we", "our work", or its name) caused a business outcome. */
const CLAIM_SUBJECT = /\b(?:we|our (?:work|team|research|strategy|strategies|approach|engagement|campaign|brand(?:ing)?))\b/i;
const CLAIM_VERB = /\b(?:attracted|drove|driven|delivered|generated|increased|boosted|grew|produced|secured|raised|brought in|resulted in|led to|tripled|doubled)\b/i;
const CLAIM_OUTCOME = /\b(?:investment|sales|revenue|visit(?:or|ation)s?|occupancy|bookings|growth|tenants|residents|traffic|leads|roi|returns?)\b/i;

const startsWithText = (text: string, opening: string) => normaliseForMatch(text).startsWith(normaliseForMatch(opening));

/** Capitalised multi-word names, e.g. "Hudson Yards", minus a leading sentence word like "And". */
function properNames(text: string): string[] {
  const COMMON = new Set(["and", "but", "by", "the", "we", "our", "your", "in", "i", "at", "as", "with", "for", "this", "that", "when", "while", "from", "since", "it", "its", "a", "an"]);
  const names: string[] = [];
  for (const match of text.matchAll(/\b[A-Z][\w'’&-]*(?:\s+(?:of|the|at|and|&|on|de|la)?\s*[A-Z][\w'’&-]*)+/g)) {
    const words = match[0].split(/\s+/);
    while (words.length > 0 && COMMON.has(words[0]!.toLowerCase())) words.shift();
    if (words.length >= 2) names.push(words.join(" "));
  }
  return names;
}

/** A paragraph that opens like this is an instruction to the writer, not copy to keep. */
const INSTRUCTION_START =
  /^["'“‘]?(?:start|begin|write|use|keep|continue|mention|compliment|add|include|make|do not|don't|never|avoid|end|open|create|describe|explain|summari[sz]e|generate|give|list|say|state|refer(?:ence)?|ask|tell|in (?:one|two|three) sentences?|one sentence|two sentences)\b/i;

/**
 * Fixed wording of a template: the text around the placeholders of each paragraph that has at least
 * two of them and reads as copy ("We specialize in scaling {{…}} by {{…}}"), not as an instruction
 * ("Start with … and continue {{…}}"). Rule sentences after the last placeholder are left out, and
 * only runs of three or more words count, so a lone "and" or "your" may be adapted for grammar.
 */
export function templateWording(instructions: string): string[][] {
  return instructions
    .replace(SPLIT_MARKER, " ")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => (paragraph.match(/\{\{[^{}]+\}\}/g) ?? []).length >= 2 && !INSTRUCTION_START.test(paragraph))
    .map((paragraph) => {
      const chunks = paragraph.split(/\{\{[^{}]+\}\}/);
      // After the last placeholder, keep only the rest of that sentence.
      chunks[chunks.length - 1] = chunks.at(-1)!.split(/(?<=[.!?])\s/)[0]!;
      return chunks.map((chunk) => normaliseForMatch(chunk)).filter((chunk) => chunk.split(" ").length >= 3);
    })
    .filter((chunks) => chunks.length > 0);
}

/** Template chunks missing from the output, or out of order. */
function missingWording(instructions: string, text: string): string[] {
  const output = normaliseForMatch(text);
  const missing: string[] = [];
  for (const chunks of templateWording(instructions)) {
    let from = 0;
    for (const chunk of chunks) {
      const at = output.indexOf(chunk, from);
      if (at === -1) missing.push(`"${chunk}"`);
      else from = at + chunk.length;
    }
  }
  return missing;
}

export interface ValidateInput {
  variable: AiVariable;
  all: AiVariable[];
  generated: GeneratedVariable;
  plan: PersonalisationPlan;
  context: WriterContext;
  results: Record<string, VariableResult>;
}

/** Every check on one generated value; `fail` checks trigger a correction, `warn` checks are shown only. */
export function validateVariable(input: ValidateInput): ValidationCheck[] {
  const { variable, all, generated, plan, context, results } = input;
  const text = formatText(generated.text);
  const rules = effectiveRules(variable);
  const names = all.map((v) => v.name).filter((n) => n !== variable.name);
  const placeholders = parsePlaceholders(variable.instructions, names);
  const deps = new Set(variableDependencies(variable, all));
  const checks: ValidationCheck[] = [];
  const add = (id: string, label: string, ok: boolean | "warn", detail?: string) =>
    checks.push({ id, label, status: ok === true ? "pass" : ok === "warn" ? "warn" : "fail", ...(detail ? { detail } : {}) });

  if (!text) {
    add("empty", "Output written", false, "the writer returned no text");
    return checks;
  }

  const leftover = [...text.matchAll(/\{\{[^{}]*\}\}/g)].map((m) => m[0]).filter((token) => !isMailMergeToken(token));
  add("placeholders", "All placeholders resolved", leftover.length === 0, leftover.length ? `unresolved: ${leftover.join(", ")}` : undefined);
  const dynamic = placeholders.filter((p) => p.kind === "dynamic");
  const unreported = dynamic.filter((p) => !(p.raw in generated.resolved) && !(p.key in generated.resolved));
  if (dynamic.length > 0) {
    add(
      "resolution",
      "Every dynamic placeholder has a resolved value",
      unreported.length === 0 ? true : "warn",
      unreported.length ? `no resolved value reported for ${unreported.map((p) => p.raw).join(", ")}` : undefined,
    );
  }

  if (templateWording(variable.instructions).length > 0) {
    const missing = missingWording(variable.instructions, text);
    // A warning only: small rewordings of the template read fine and should not throw a good text away.
    add("wording", "Template wording kept", missing.length === 0 ? true : "warn", missing.length ? `changed or missing: ${missing.join(", ")}` : undefined);
  }

  const splits = splitMarkerCount(variable.instructions);
  if (splits > 0) {
    const breaks = paragraphBreaks(text);
    add(
      "breaks",
      `${splits} paragraph break${splits === 1 ? "" : "s"} where the instructions say ||split||`,
      breaks >= splits,
      `${breaks} found`,
    );
  }

  const withoutMerge = text.replace(/\{\{[^{}]*\}\}/g, (token) => (isMailMergeToken(token) ? "" : token));
  add("brackets", "No brackets", !/[[\]{}<>]/.test(withoutMerge));

  const words = wordCount(text);
  // Too long fails; too short is only a warning.
  add("words", `${rules.minWords}-${rules.maxWords} words`, words > rules.maxWords ? false : words >= rules.minWords ? true : "warn", `${words} words`);
  if (rules.maxChars) add("chars", `At most ${rules.maxChars} characters`, text.length <= rules.maxChars, `${text.length} characters`);

  const sentences = splitSentences(text);
  if (rules.sentences) add("sentences", `Exactly ${rules.sentences} sentence${rules.sentences === 1 ? "" : "s"}`, sentences.length === rules.sentences, `${sentences.length} found`);
  if (rules.startsWith) {
    const options = rules.startsWith;
    add("starts", `Starts with ${options.map((o) => `"${o}"`).join(" or ")}`, options.some((o) => startsWithText(text, o)));
  }
  for (const s of rules.sentenceStarts) {
    const sentence = sentences[s.sentence - 1];
    add(
      `sentence-${s.sentence}`,
      `Sentence ${s.sentence} starts with "${s.text}"`,
      sentence && startsWithText(sentence, s.text) ? true : "warn",
      sentence ? undefined : "sentence missing",
    );
  }
  if (rules.noCta) {
    const cta = CTA.exec(text)?.[0] ?? (/\?\s*$/.test(text) ? "ends with a question" : null);
    add("cta", "No call to action", !cta, cta ?? undefined);
  }

  // "Our work with X attracted $3 billion in investment": a result the sender cannot claim.
  const sender = context.copy.senderName.trim().toLowerCase();
  const claims = sentences.filter(
    (s) => (CLAIM_SUBJECT.test(s) || (sender !== "" && s.toLowerCase().includes(sender))) && CLAIM_VERB.test(s) && CLAIM_OUTCOME.test(s),
  );
  add("claims", "Does not claim results for the sender", claims.length === 0, claims.length ? `"${claims[0]}"` : undefined);

  const lower = text.toLowerCase();
  const banned = context.copy.bannedPhrases.filter((phrase) => phrase && lower.includes(phrase.toLowerCase()));
  add("banned", "No banned phrases", banned.length === 0, banned.length ? banned.map((b) => `"${b}"`).join(", ") : undefined);
  add("tracking", "Does not mention the website visit", !mentionsTracking(text));

  // Everything a claim may legitimately come from.
  const values = dataValues(context);
  const corpus = normaliseForMatch(
    [
      context.crawlText ?? "",
      context.copy.companyDescription,
      context.copy.offer,
      ...context.copy.services,
      ...context.copy.proof,
      plan.description,
      plan.category,
      plan.industry,
      ...plan.activities,
      ...plan.details.flatMap((d) => [d.name, d.detail, d.evidence]),
      variable.instructions,
      ...variable.examples,
      ...Object.values(values).filter((v): v is string => Boolean(v)),
      context.company.industry ?? "",
      ...[...deps].map((d) => results[d]?.text ?? ""),
    ].join("\n"),
  );

  // Compared as normalised tokens, so "28th", "$500 billion" and "1,200" match their source spelling.
  const corpusTokens = new Set(corpus.split(" "));
  const figures = normaliseForMatch(text)
    .split(" ")
    .filter((token) => /\d/.test(token) && !corpusTokens.has(token));
  add("figures", "No invented figures", figures.length === 0, figures.length ? `not in the research or approved proof: ${[...new Set(figures)].join(", ")}` : undefined);

  const unknownIds = generated.detailIds.filter((id) => !plan.details.some((d) => d.id === id));
  add("evidence", "Named details are backed by the website", unknownIds.length === 0, unknownIds.length ? `cites unverified details ${unknownIds.join(", ")}` : undefined);
  const unsupportedNames = [...new Set(properNames(text))].filter((name) => !corpus.includes(normaliseForMatch(name)));
  add(
    "names",
    "No unsupported names",
    unsupportedNames.length === 0 ? true : "warn",
    unsupportedNames.length ? `not found in the research or client context: ${unsupportedNames.join(", ")}` : undefined,
  );

  const wantsDetail = dynamic.some((p) => /project|achievement|specific|named|case stud|partnership|product|development|portfolio/i.test(p.key));
  if (wantsDetail) {
    const missing = generated.detailIds.length === 0 || generated.insufficientEvidence.length > 0;
    add(
      "personalisation",
      "Uses a specific, verified detail",
      missing ? "warn" : true,
      generated.insufficientEvidence.length
        ? `insufficient evidence for ${generated.insufficientEvidence.join(", ")}`
        : missing
          ? "no verified detail cited"
          : undefined,
    );
  }

  const repeated = generated.detailIds.filter((id) =>
    Object.values(results).some((r) => r.name !== variable.name && !deps.has(r.name) && r.status === "ok" && r.detailIds.includes(id)),
  );
  if (generated.detailIds.length > 0) {
    add("repeat", "Personalisation not repeated across variables", repeated.length === 0 ? true : "warn", repeated.length ? `also used elsewhere: ${repeated.join(", ")}` : undefined);
  }

  for (const dep of deps) {
    const result = results[dep];
    if (!result || result.status !== "ok") add(`dependency-${dep}`, `Uses the finished ${dep}`, false, `${dep} is not available`);
  }
  return checks;
}

export const failedChecks = (checks: ValidationCheck[]) => checks.filter((c) => c.status === "fail");
const describe = (c: ValidationCheck) => (c.detail ? `${c.label}: ${c.detail}` : c.label);

// ---------- orchestration ----------

export interface GenerateInput {
  context: WriterContext;
  plan: PersonalisationPlan;
  /** All of the client's AI variables (needed for dependencies). */
  variables: AiVariable[];
  /** Only (re)write these; others are taken from `previous`. Default: all. */
  only?: string[];
  previous?: Record<string, VariableResult>;
  maxCorrections?: number;
}

export interface GenerateOutput {
  results: Record<string, VariableResult>;
  costUsd: number;
  calls: number;
  model: string | null;
}

function sourcesFor(detailIds: string[], plan: PersonalisationPlan): { url: string; label: string }[] {
  const seen = new Set<string>();
  const sources: { url: string; label: string }[] = [];
  for (const id of detailIds) {
    const detail = plan.details.find((d) => d.id === id);
    if (!detail?.sourceUrl) continue;
    const key = `${detail.sourceUrl}|${detail.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ url: detail.sourceUrl, label: detail.name });
  }
  return sources;
}

/**
 * Writes variables in dependency order (one call per layer), validates each, and asks for corrections
 * of failed ones up to `maxCorrections` times with the same research. Throws LlmTransientError on
 * retryable API errors; other API errors fail the affected variables.
 */
export async function generateVariables(input: GenerateInput, llm: LlmJsonCall): Promise<GenerateOutput> {
  const { context, plan, variables } = input;
  const order = dependencyOrder(variables);
  if (!order.ok) throw new Error(`circular dependency: ${order.cycle.join(" → ")}`);
  const targets = new Set(input.only ?? variables.map((v) => v.name));
  const results: Record<string, VariableResult> = Object.fromEntries(
    Object.entries(input.previous ?? {}).filter(([name]) => !targets.has(name) && variables.some((v) => v.name === name)),
  );
  const byName = new Map(variables.map((v) => [v.name, v]));
  const maxCorrections = input.maxCorrections ?? MAX_CORRECTIONS;
  let costUsd = 0;
  let calls = 0;
  let model: string | null = null;

  const base = (variable: AiVariable): Omit<VariableResult, "status" | "text"> => ({
    name: variable.name,
    resolved: {},
    placeholders: parsePlaceholders(variable.instructions, variables.map((v) => v.name).filter((n) => n !== variable.name)).map((p) => ({ raw: p.raw, kind: p.kind })),
    detailIds: [],
    insufficientEvidence: [],
    sources: [],
    checks: [],
    words: 0,
    chars: 0,
    attempts: [],
    dependsOn: variableDependencies(variable, variables),
    generatedAt: new Date().toISOString(),
  });

  for (const layer of order.layers) {
    const pending: AiVariable[] = [];
    for (const name of layer.filter((n) => targets.has(n))) {
      const variable = byName.get(name)!;
      const missing = variableDependencies(variable, variables).filter((d) => results[d]?.status !== "ok");
      if (missing.length > 0) {
        results[name] = { ...base(variable), status: "blocked", text: null, error: `waiting on ${missing.join(", ")}, which did not pass` };
      } else {
        pending.push(variable);
      }
    }

    const attempts = new Map<string, VariableAttempt[]>();
    let todo = pending;
    for (let round = 0; round <= maxCorrections && todo.length > 0; round++) {
      const tasks = todo.map((variable) => ({ variable, feedback: attempts.get(variable.name)?.at(-1) }));
      const reply = await llm(buildWriterPrompt({ context, plan, all: variables, tasks, results }));
      calls++;
      if (!reply.ok) {
        if (reply.transient) throw new LlmTransientError(reply.code, reply.detail);
        for (const variable of todo) {
          results[variable.name] = { ...base(variable), status: "failed", text: null, attempts: attempts.get(variable.name) ?? [], error: reply.code };
        }
        todo = [];
        break;
      }
      costUsd += reply.costUsd;
      model = reply.model;
      const written = parseWriterReply(reply.json);

      const next: AiVariable[] = [];
      for (const variable of todo) {
        const generated = written?.[variable.name] ?? { text: "", resolved: {}, detailIds: [], insufficientEvidence: [] };
        const text = formatText(generated.text);
        const checks = written
          ? validateVariable({ variable, all: variables, generated, plan, context, results })
          : [{ id: "reply", label: "Writer reply readable", status: "fail" as const, detail: "reply did not match {variables: {...}}" }];
        const failures = failedChecks(checks);
        const history = [...(attempts.get(variable.name) ?? []), { text, problems: failures.map(describe) }];
        attempts.set(variable.name, history);
        const earlier = results[variable.name];
        if (!text && earlier?.text && earlier.status === "failed") {
          // An empty correction is worse than the attempt it was meant to fix: keep showing that one.
          results[variable.name] = { ...earlier, attempts: history };
          next.push(variable);
          continue;
        }
        const result: VariableResult = {
          ...base(variable),
          status: failures.length === 0 ? "ok" : "failed",
          text: text || null,
          resolved: generated.resolved,
          detailIds: generated.detailIds.filter((id) => plan.details.some((d) => d.id === id)),
          insufficientEvidence: generated.insufficientEvidence,
          sources: sourcesFor(generated.detailIds, plan),
          checks,
          words: wordCount(text),
          chars: text.length,
          attempts: history,
        };
        results[variable.name] = result;
        if (failures.length > 0) next.push(variable);
      }
      todo = next;
    }
  }

  // Keep the caller's order.
  const ordered = Object.fromEntries(variables.filter((v) => results[v.name]).map((v) => [v.name, results[v.name]!]));
  return { results: ordered, costUsd, calls, model };
}

/** Problems of each variable that did not pass, in the shape the lead page shows. */
export function rejectedVariables(results: Record<string, VariableResult>): Record<string, string[]> {
  return Object.fromEntries(
    Object.values(results)
      .filter((r) => r.status !== "ok")
      .map((r) => [r.name, r.error ? [r.error] : failedChecks(r.checks).map(describe)]),
  );
}

/** Text of each variable that passed. */
export function passedValues(results: Record<string, VariableResult>): Record<string, string> {
  return Object.fromEntries(Object.values(results).filter((r) => r.status === "ok" && r.text).map((r) => [r.name, r.text!]));
}
