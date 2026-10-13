import type { AiVariable, AiVariablesOutput, ClientSettings, CompanySummary, LeadPage } from "@enrich/shared";

/** Bump when the prompt below changes meaningfully; stored with each result. */
export const VARIABLES_PROMPT_VERSION = 2;

const WEBSITE_EXCERPT_CHARS = 2500;

export interface VariablesPromptInput {
  copy: ClientSettings["copy"];
  variables: AiVariable[];
  contact: { firstName: string | null; lastName: string | null; title: string | null };
  company: {
    domain: string;
    name: string | null;
    industry: string | null;
    country: string | null;
    summary: CompanySummary | null;
    /** Raw website text; used (trimmed) only when there is no summary. */
    crawlText?: string | null;
  };
  intentTopic: string | null;
  pages: LeadPage[];
}

/** Best available description of the company; falls back to name + industry until research has run. */
function companyFacts(company: VariablesPromptInput["company"]): string {
  const name = company.name ?? company.domain;
  const lines = [`Name: ${name}`, `Website: ${company.domain}`];
  if (company.industry) lines.push(`Industry: ${company.industry}`);
  if (company.country) lines.push(`Country: ${company.country}`);
  const { summary } = company;
  if (summary) {
    lines.push(`What they do: ${summary.oneLiner}`, `Sells: ${summary.whatTheySell}`, `Sells to: ${summary.whoTheySellTo}`);
    if (summary.personalisationHooks.length > 0) lines.push(`Specific details: ${summary.personalisationHooks.join("; ")}`);
    if (summary.recentNews) lines.push(`Recent news: ${summary.recentNews}`);
  } else if (company.crawlText) {
    lines.push(`From their website (excerpt):\n${company.crawlText.slice(0, WEBSITE_EXCERPT_CHARS)}`);
  }
  return lines.join("\n");
}

function variableSpec(variable: AiVariable): string {
  const limits = [`${variable.minWords}-${variable.maxWords} words`];
  if (variable.maxChars) limits.push(`at most ${variable.maxChars} characters`);
  const examples = variable.examples.length > 0 ? `\n  Good examples:\n${variable.examples.map((e) => `  - ${e}`).join("\n")}` : "";
  return `- ${variable.name} (${limits.join(", ")}): ${variable.instructions}${examples}`;
}

/** One prompt for all of a client's variables; asks for two candidates each. */
export function buildVariablesPrompt(input: VariablesPromptInput): string {
  const { copy, contact, variables } = input;
  const person = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "unknown name";
  // Topics come from page paths the company visited; used only to steer relevance, never mentioned.
  const topic = input.intentTopic || "general";

  return `You write personalised snippets for a cold email from ${copy.senderName || "the sender"}.
Sender's company: ${copy.companyDescription || "not described"}
Offer: ${copy.offer || "not described"}
Tone: ${copy.tone}

Recipient: ${person}, ${contact.title || "unknown role"}
Recipient's company:
${companyFacts(input.company)}
Topic they are likely interested in: ${topic}

Write these variables:
${variables.map(variableSpec).join("\n")}

Rules:
- Each variable is inserted into a fixed email template, so it must read naturally on its own.
- Be specific to this company; only state facts given above. If little is known, stay general rather than invent.
- Never mention a website visit, browsing, tracking or how we found them.
- No placeholders, brackets, emojis or generic flattery.
- Never use these phrases: ${copy.bannedPhrases.join(", ") || "none"}

Return JSON: {"variables": {"<name>": ["<best candidate>", "<second candidate>"]}} with every variable listed above.`;
}

const TRACKING_WORDS = /\b(visit(ed|ing)?|browsing|browsed|tracking|tracked|our (web)?site|saw you (on|were))\b/i;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Problems that make a generated value unsafe to send; empty when it passes. */
export function checkVariable(variable: AiVariable, text: string, bannedPhrases: string[]): string[] {
  const problems: string[] = [];
  const words = wordCount(text);
  if (words < variable.minWords || words > variable.maxWords) {
    problems.push(`${words} words, needs ${variable.minWords}-${variable.maxWords}`);
  }
  if (variable.maxChars && text.length > variable.maxChars) problems.push(`longer than ${variable.maxChars} characters`);
  if (/[[\]{}<>]/.test(text)) problems.push("contains brackets or placeholders");
  if (TRACKING_WORDS.test(text)) problems.push("mentions the website visit or tracking");
  const lower = text.toLowerCase();
  for (const phrase of bannedPhrases) {
    if (phrase && lower.includes(phrase.toLowerCase())) problems.push(`uses banned phrase "${phrase}"`);
  }
  return problems;
}

export interface PickedVariables {
  values: Record<string, string>;
  /** Variables with no passing candidate, with the problems of each candidate. */
  rejected: Record<string, string[]>;
}

/** Keeps the first candidate per variable that passes its checks. */
export function pickVariables(variables: AiVariable[], output: AiVariablesOutput, bannedPhrases: string[]): PickedVariables {
  const values: Record<string, string> = {};
  const rejected: Record<string, string[]> = {};
  for (const variable of variables) {
    const raw = output.variables[variable.name];
    const candidates = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((c) => c.trim().replace(/\s+/g, " ")).filter(Boolean);
    const problems: string[] = [];
    for (const candidate of candidates) {
      const found = checkVariable(variable, candidate, bannedPhrases);
      if (found.length === 0) {
        values[variable.name] = candidate;
        break;
      }
      problems.push(`"${candidate}": ${found.join(", ")}`);
    }
    if (!(variable.name in values)) rejected[variable.name] = candidates.length > 0 ? problems : ["not returned"];
  }
  return { values, rejected };
}
