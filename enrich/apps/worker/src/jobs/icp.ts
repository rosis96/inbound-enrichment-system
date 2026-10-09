import { LeadJobData } from "@enrich/shared";
import type { JobContext } from "../context";

export const schema = LeadJobData;

// TODO (phase 3: ICP score + intent mapping)
export async function handleIcp(data: LeadJobData, ctx: JobContext): Promise<void> {
  ctx.logger.warn({ leadId: data.leadId }, "icp not implemented yet");
}
