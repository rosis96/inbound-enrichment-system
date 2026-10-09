import { NormaliseJobData } from "@enrich/shared";
import type { JobContext } from "../context";

export const schema = NormaliseJobData;

// TODO (phase 2): parse raw payload, upsert company, create lead + contacts, enqueue lead.gates
export async function handleNormalise(data: NormaliseJobData, ctx: JobContext): Promise<void> {
  ctx.logger.warn({ rawEventId: data.rawEventId }, "normalise not implemented yet");
}
