import { z } from "zod";

export const CompanySummary = z.object({
  oneLiner: z.string().min(1),
  whatTheySell: z.string(),
  whoTheySellTo: z.string(),
  sizeSignals: z.string(),
  recentNews: z.string().nullable().optional(),
  personalisationHooks: z.array(z.string()).max(3),
});
export type CompanySummary = z.infer<typeof CompanySummary>;


// ---------- research-backed personalisation plan ----------

export const DETAIL_KINDS = ["project", "product", "achievement", "partnership", "case_study", "capability", "announcement"] as const;

/** One specific, checkable fact about the prospect, with the website text that supports it. */
export const PlanDetail = z.object({
  id: z.string().min(1),
  kind: z.enum(DETAIL_KINDS).catch("capability"),
  name: z.string().min(1),
  /** What it is and why it matters, in the researcher's words. */
  detail: z.string().default(""),
  /** Short quote from the website text. */
  evidence: z.string().default(""),
  sourceUrl: z.string().nullable().default(null),
  /** Set by us, not the model: the evidence or name was found in the crawled text. */
  verified: z.boolean().default(false),
});
export type PlanDetail = z.infer<typeof PlanDetail>;

const phrases = (max: number) =>
  z
    .array(z.string())
    .default([])
    .transform((list) => list.map((item) => item.trim()).filter(Boolean).slice(0, max));

/**
 * Shared context for every variable of one prospect: confirmed facts (with sources), the client's
 * relevant services, and strategic interpretation (possible challenges and benefits), kept apart.
 */
export const PersonalisationPlan = z.object({
  /** Detailed description of what the company does (fact). */
  description: z.string().default(""),
  /** Category for outreach, e.g. "mixed-use real estate developers". */
  category: z.string().default(""),
  /** Broader industry, e.g. "mixed-use real estate". */
  industry: z.string().default(""),
  activities: phrases(8),
  details: z.array(PlanDetail).default([]),
  primaryDetailId: z.string().nullable().default(null),
  alternativeDetailId: z.string().nullable().default(null),
  /** Chosen from the client's services. */
  relevantServices: phrases(6),
  /** Interpretation: challenges the client could address, not admitted problems. */
  challenges: phrases(6),
  benefits: phrases(6),
  longTermOutcomes: phrases(4),
  /** Chosen from the client's approved proof. */
  proof: phrases(4),
  /** Things that cannot be established from public evidence; never stated as fact. */
  unknowns: phrases(8),
});
export type PersonalisationPlan = z.infer<typeof PersonalisationPlan>;

/** One generated value per variable, as returned by the writer. */
export const GeneratedVariable = z.object({
  text: z.string().default(""),
  /** Placeholder as written → the text used for it. */
  resolved: z.record(z.string(), z.string()).default({}),
  detailIds: z.array(z.string()).default([]),
  /** Placeholders that needed a specific detail the research could not support. */
  insufficientEvidence: z.array(z.string()).default([]),
});
export type GeneratedVariable = z.infer<typeof GeneratedVariable>;

export const GeneratedVariablesOutput = z.object({
  variables: z.record(z.string(), GeneratedVariable),
});

export type CheckStatus = "pass" | "warn" | "fail";

export interface ValidationCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface VariableAttempt {
  text: string;
  problems: string[];
}

/** Final state of one variable after generation, checks and corrections. */
export interface VariableResult {
  name: string;
  /** `blocked`: a variable it depends on failed, so it was not written. */
  status: "ok" | "failed" | "blocked";
  text: string | null;
  resolved: Record<string, string>;
  /** Kind of each placeholder in the instructions, keyed by how it is written. */
  placeholders: { raw: string; kind: "data" | "variable" | "dynamic" }[];
  detailIds: string[];
  insufficientEvidence: string[];
  sources: { url: string; label: string }[];
  checks: ValidationCheck[];
  words: number;
  chars: number;
  /** Every attempt, the last one being `text` when ok. */
  attempts: VariableAttempt[];
  dependsOn: string[];
  generatedAt: string;
  error?: string;
}
