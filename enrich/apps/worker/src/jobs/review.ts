import { LeadJobData } from "@enrich/shared";
import type { JobContext } from "../context";

export const schema = LeadJobData;

// TODO (phase 6: auto-approve or await review)
export async function handleReview(data: LeadJobData, ctx: JobContext): Promise<void> {
  ctx.logger.warn({ leadId: data.leadId }, "review not implemented yet");
}
