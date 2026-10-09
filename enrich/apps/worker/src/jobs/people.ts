import { LeadJobData } from "@enrich/shared";
import type { JobContext } from "../context";

export const schema = LeadJobData;

// TODO (phase 4: rank Happierleads contacts, optional people search)
export async function handlePeople(data: LeadJobData, ctx: JobContext): Promise<void> {
  ctx.logger.warn({ leadId: data.leadId }, "people not implemented yet");
}
