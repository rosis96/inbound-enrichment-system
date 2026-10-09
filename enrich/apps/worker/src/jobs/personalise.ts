import { LeadJobData } from "@enrich/shared";
import type { JobContext } from "../context";

export const schema = LeadJobData;

// TODO (phase 5: first line + subject with guardrails)
export async function handlePersonalise(data: LeadJobData, ctx: JobContext): Promise<void> {
  ctx.logger.warn({ leadId: data.leadId }, "personalise not implemented yet");
}
