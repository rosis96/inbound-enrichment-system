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

export const FirstLineOutput = z.object({
  firstLine: z.string().min(1),
  subjectLine: z.string().min(1),
});
export type FirstLineOutput = z.infer<typeof FirstLineOutput>;
