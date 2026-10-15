// Parsing of AI-variable instructions: `{{placeholders}}`, dependencies between variables and the
// structural rules written in plain English ("exactly two sentences", "under 85 words", …).
// Pure functions so the settings editor, the validator and the worker read instructions the same way.

/** Any `{{ … }}` in instructions; the content may be free text such as `{{2-3 challenges}}`. */
const ANY_PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * - `data`: a known lead field (`{{firstName}}`), filled from the lead or kept for Instantly's mail merge
 * - `variable`: another AI variable's finished output (`{{value_proposition}}`)
 * - `dynamic`: a description of what to write (`{{2-3 challenges they might face}}`), resolved by the AI
 */
export type PlaceholderKind = "data" | "variable" | "dynamic";

export interface Placeholder {
  /** Exactly as written, e.g. `{{ firstName|there }}`. */
  raw: string;
  /** Text inside the braces without the fallback, e.g. `firstName` or `2-3 challenges`. */
  key: string;
  kind: PlaceholderKind;
  /** `data`: canonical field name; `variable`: the referenced variable's name. */
  ref?: string;
  /** `data` only: text after `|`. */
  fallback?: string;
  /** `data` only: filled by Instantly at send time, so it is kept as `{{name}}` in the output. */
  mailMerge?: boolean;
}

/** Lead fields a placeholder can name; keys are normalised (lowercase, no spaces, `_` or `-`). */
const DATA_FIELDS: Record<string, string> = {
  firstname: "firstName",
  lastname: "lastName",
  fullname: "fullName",
  email: "email",
  companyname: "companyName",
  website: "website",
  domain: "domain",
  jobtitle: "jobTitle",
  title: "jobTitle",
  country: "country",
};

/** Filled by Instantly from the sending account, never known when the variable is written. */
const MAIL_MERGE_FIELDS: Record<string, string> = {
  sendingaccountfirstname: "sendingAccountFirstName",
  accountsignature: "accountSignature",
  phone: "phone",
  personalization: "personalization",
};

const normaliseKey = (key: string) => key.toLowerCase().replace(/[\s_-]+/g, "");
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_ -]*$/;

/** Placeholders in order of first appearance (each distinct `raw` once). */
export function parsePlaceholders(text: string, variableNames: string[] = []): Placeholder[] {
  const variables = new Map(variableNames.map((name) => [normaliseKey(name), name]));
  const seen = new Set<string>();
  const found: Placeholder[] = [];
  for (const match of text.matchAll(ANY_PLACEHOLDER)) {
    const raw = match[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    const inner = match[1]!.trim();
    const bar = inner.indexOf("|");
    const head = bar === -1 ? inner : inner.slice(0, bar).trim();
    const fallback = bar === -1 ? undefined : inner.slice(bar + 1).trim();
    const normal = normaliseKey(head);

    if (IDENTIFIER.test(head) && variables.has(normal)) {
      found.push({ raw, key: head, kind: "variable", ref: variables.get(normal) });
    } else if (IDENTIFIER.test(head) && DATA_FIELDS[normal]) {
      found.push({ raw, key: head, kind: "data", ref: DATA_FIELDS[normal], fallback });
    } else if (IDENTIFIER.test(head) && MAIL_MERGE_FIELDS[normal]) {
      found.push({ raw, key: head, kind: "data", ref: MAIL_MERGE_FIELDS[normal], fallback, mailMerge: true });
    } else {
      // A `|` in free text is part of the description, not a fallback.
      found.push({ raw, key: inner, kind: "dynamic" });
    }
  }
  return found;
}

/** Mail-merge tokens allowed to stay in a finished output, e.g. `{{accountSignature}}`. */
export function isMailMergeToken(token: string): boolean {
  const inner = token.replace(/^\{\{\s*|\s*\}\}$/g, "").split("|")[0]!.trim();
  return Boolean(MAIL_MERGE_FIELDS[normaliseKey(inner)]);
}

// ---------- dependencies ----------

export interface VariableDeps {
  name: string;
  instructions: string;
  dependsOn?: string[];
}

/** Variables this one needs first: the explicit list plus every `{{otherVariable}}` in its instructions. */
export function variableDependencies(variable: VariableDeps, all: VariableDeps[]): string[] {
  const names = all.map((v) => v.name).filter((name) => name !== variable.name);
  const referenced = parsePlaceholders(variable.instructions, names)
    .filter((p) => p.kind === "variable")
    .map((p) => p.ref!);
  return [...new Set([...(variable.dependsOn ?? []), ...referenced])].filter((name) => name !== variable.name);
}

/**
 * Other variables named in plain text (not in braces, not already a dependency), e.g. "continue the
 * idea from value_proposition". Shown as a suggestion only; never added automatically.
 */
export function suggestedDependencies(variable: VariableDeps, all: VariableDeps[]): string[] {
  const current = new Set(variableDependencies(variable, all));
  const plain = variable.instructions.replace(ANY_PLACEHOLDER, " ");
  return all
    .map((v) => v.name)
    .filter((name) => name !== variable.name && !current.has(name))
    .filter((name) => new RegExp(`(^|[^A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_]|$)`, "i").test(plain));
}

export type DependencyOrder = { ok: true; layers: string[][] } | { ok: false; cycle: string[] };

/** Variables grouped so each group only needs earlier groups; reports the first cycle found. */
export function dependencyOrder(all: VariableDeps[]): DependencyOrder {
  const names = new Set(all.map((v) => v.name));
  const deps = new Map(all.map((v) => [v.name, variableDependencies(v, all).filter((d) => names.has(d))]));

  // Find a cycle with a depth-first walk so the message can name it.
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (name: string): string[] | null => {
    if (state.get(name) === "done") return null;
    if (state.get(name) === "visiting") return [...stack.slice(stack.indexOf(name)), name];
    state.set(name, "visiting");
    stack.push(name);
    for (const dep of deps.get(name) ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(name, "done");
    return null;
  };
  for (const v of all) {
    const cycle = visit(v.name);
    if (cycle) return { ok: false, cycle };
  }

  const layers: string[][] = [];
  const placed = new Set<string>();
  while (placed.size < all.length) {
    const layer = all.map((v) => v.name).filter((name) => !placed.has(name) && (deps.get(name) ?? []).every((d) => placed.has(d)));
    layers.push(layer);
    layer.forEach((name) => placed.add(name));
  }
  return { ok: true, layers };
}

/** `names` plus every variable they need first, directly or not (to test one variable on its own). */
export function withDependencies(names: string[], all: VariableDeps[]): string[] {
  const result = new Set(names);
  const queue = [...names];
  while (queue.length > 0) {
    const variable = all.find((v) => v.name === queue.shift());
    for (const dep of variable ? variableDependencies(variable, all) : []) {
      if (!result.has(dep) && all.some((v) => v.name === dep)) {
        result.add(dep);
        queue.push(dep);
      }
    }
  }
  return all.map((v) => v.name).filter((name) => result.has(name));
}

/** `names` plus every variable that depends on any of them, directly or not. */
export function withDependents(names: string[], all: VariableDeps[]): string[] {
  const result = new Set(names);
  let grew = true;
  while (grew) {
    grew = false;
    for (const v of all) {
      if (!result.has(v.name) && variableDependencies(v, all).some((d) => result.has(d))) {
        result.add(v.name);
        grew = true;
      }
    }
  }
  return all.map((v) => v.name).filter((name) => result.has(name));
}

// ---------- structural rules written in the instructions ----------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
};
const toNumber = (word: string) => (/^\d+$/.test(word) ? Number(word) : (NUMBER_WORDS[word.toLowerCase()] ?? NaN));
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";
// "double" or “curly” quotes, or 'single' quotes whose text may contain apostrophes (I've).
const QUOTED = `(?:["“]([^"”\\n]{1,100})["”]|['‘]([^\\n]{1,100}?)['’](?=[\\s.,;:)]|$))`;

export interface InstructionRules {
  sentences?: number;
  minWords?: number;
  maxWords?: number;
  maxChars?: number;
  /** Accepted openings of the whole output ("Start with 'A' or 'B'" gives two). */
  startsWith?: string[];
  /** Required opening of a given sentence (1-based). */
  sentenceStarts: { sentence: number; text: string }[];
  noCta: boolean;
}

/** Rules a writer would read in the instructions, e.g. "Write exactly two sentences" or "Start with 'By the way,'". */
export function rulesFromInstructions(instructions: string): InstructionRules {
  const text = instructions.replace(ANY_PLACEHOLDER, " ");
  const rules: InstructionRules = { sentenceStarts: [], noCta: false };

  const sentences = text.match(new RegExp(`\\b(?:exactly|only|just|in|use|write|of)\\s+${NUM}\\s+sentences?\\b`, "i"));
  if (sentences) rules.sentences = toNumber(sentences[1]!);

  const range = text.match(/\b(\d+)\s*(?:-|–|to)\s*(\d+)\s+words\b/i) ?? text.match(/\bbetween\s+(\d+)\s+and\s+(\d+)\s+words\b/i);
  if (range) {
    rules.minWords = Number(range[1]);
    rules.maxWords = Number(range[2]);
  }
  const maxWords =
    text.match(/\b(max(?:imum)?(?:\s+of)?|at most|no more than|up to|not (?:to )?exceed(?:ing)?|under|fewer than|less than|below)\s+(\d+)\s+words\b/i) ??
    null;
  if (maxWords) {
    const strict = /under|fewer|less|below/i.test(maxWords[1]!);
    rules.maxWords = Number(maxWords[2]) - (strict ? 1 : 0);
  } else {
    const trailing = text.match(/\b(\d+)\s+words?\s+(?:max(?:imum)?|or (?:less|fewer))\b/i);
    if (trailing) rules.maxWords = Number(trailing[1]);
  }
  const minWords = text.match(/\b(?:at least|min(?:imum)?(?:\s+of)?|no fewer than|no less than)\s+(\d+)\s+words\b/i);
  if (minWords) rules.minWords = Number(minWords[1]);

  const maxChars = text.match(/\b(max(?:imum)?(?:\s+of)?|at most|no more than|up to|under|fewer than|less than|below)\s+(\d+)\s+(?:characters|chars)\b/i);
  if (maxChars) rules.maxChars = Number(maxChars[2]) - (/under|fewer|less|below/i.test(maxChars[1]!) ? 1 : 0);

  // "Sentence two must start with 'And, I have seen'" / "the second sentence should begin with …"
  let rest = text;
  const sentenceStart = new RegExp(
    `\\b(?:sentence\\s+${NUM}|(first|second|third|fourth|fifth)\\s+sentence)\\s+(?:must|should|has to|needs to|will)?\\s*(?:start|begin|open)s?\\s+with\\s+${QUOTED}`,
    "gi",
  );
  for (const match of text.matchAll(sentenceStart)) {
    const index = toNumber(match[1] ?? match[2]!);
    if (index >= 1) rules.sentenceStarts.push({ sentence: index, text: (match[3] ?? match[4])! });
    rest = rest.replace(match[0], " ");
  }
  // "Start the complimentary line with 'By the way,'" / "Begin with …"
  const start = rest.match(
    new RegExp(`\\b(?:start|begin|open)s?\\b[^.\\n"“'‘]{0,50}?\\bwith\\s+${QUOTED}((?:(?:\\s*,\\s*(?:or\\s+)?|\\s+(?:or|and/or)\\s+)${QUOTED})*)`, "i"),
  );
  if (start) {
    rules.startsWith = [(start[1] ?? start[2])!];
    // "… or 'Our work with'": every alternative is accepted.
    for (const alt of (start[3] ?? "").matchAll(new RegExp(QUOTED, "g"))) rules.startsWith.push((alt[1] ?? alt[2])!);
  }
  // A rule on sentence one is the same as a rule on the whole output.
  const first = rules.sentenceStarts.find((s) => s.sentence === 1);
  if (first && !rules.startsWith) rules.startsWith = [first.text];
  rules.sentenceStarts = rules.sentenceStarts.filter((s) => s.sentence !== 1);

  rules.noCta = /\b(?:no|not include an?|n't include an?|without an?|never include an?|avoid an?|exclude an?)\s+(?:cta|call[\s-]to[\s-]action)\b/i.test(text);
  return rules;
}

export interface VariableLimits {
  name: string;
  instructions: string;
  minWords: number;
  maxWords: number;
  maxChars?: number;
  sentences?: number;
  startsWith?: string;
}

export interface EffectiveRules extends InstructionRules {
  minWords: number;
  maxWords: number;
  /** Where each limit came from, for the editor and the validation report. */
  from: Partial<Record<"sentences" | "minWords" | "maxWords" | "maxChars" | "startsWith", "field" | "instructions">>;
}

/**
 * Limits actually checked. Rules written in the instructions win over the word fields (whose defaults
 * are easy to leave unchanged); the explicit sentence and opening fields win over the instructions.
 */
export function effectiveRules(variable: VariableLimits): EffectiveRules {
  const parsed = rulesFromInstructions(variable.instructions);
  const from: EffectiveRules["from"] = {};
  const maxWords = parsed.maxWords ?? variable.maxWords;
  from.maxWords = parsed.maxWords !== undefined ? "instructions" : "field";
  let minWords = parsed.minWords ?? variable.minWords;
  from.minWords = parsed.minWords !== undefined ? "instructions" : "field";
  if (minWords > maxWords) minWords = 1;

  const maxChars = parsed.maxChars ?? variable.maxChars;
  if (maxChars !== undefined) from.maxChars = parsed.maxChars !== undefined ? "instructions" : "field";
  const sentences = variable.sentences ?? parsed.sentences;
  if (sentences !== undefined) from.sentences = variable.sentences !== undefined ? "field" : "instructions";
  const field = variable.startsWith?.trim();
  const startsWith = field ? [field] : parsed.startsWith;
  if (startsWith) from.startsWith = field ? "field" : "instructions";

  return { ...parsed, minWords, maxWords, maxChars, sentences, startsWith, from };
}
