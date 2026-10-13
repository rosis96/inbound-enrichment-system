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

/** Writer reply: up to two candidates per variable name, best first. */
export const AiVariablesOutput = z.object({
  variables: z.record(z.string(), z.union([z.array(z.string()), z.string()])),
});
export type AiVariablesOutput = z.infer<typeof AiVariablesOutput>;
