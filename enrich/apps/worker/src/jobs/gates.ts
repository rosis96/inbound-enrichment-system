import { LeadJobData } from "@enrich/shared";
import type { JobContext } from "../context";

export const schema = LeadJobData;

// TODO (phase 3: suppression, dedupe, free-email, ignored-pages and own-domain gates)
export async function handleGates(data: LeadJobData, ctx: JobContext): Promise<void> {
  ctx.logger.warn({ leadId: data.leadId }, "gates not implemented yet");
}
