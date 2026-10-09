import { LeadJobData } from "@enrich/shared";
import type { JobContext } from "../context";

export const schema = LeadJobData;

// TODO (phase 5: crawl + company summary (cached per company))
export async function handleResearch(data: LeadJobData, ctx: JobContext): Promise<void> {
  ctx.logger.warn({ leadId: data.leadId }, "research not implemented yet");
}
