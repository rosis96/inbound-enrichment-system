import { getDb, sendJob } from "@enrich/db";
import { queueName, type NormaliseJobData } from "@enrich/shared";

/** Adds a `lead.normalise` job to the `jobs` table; the worker picks it up. */
export function enqueueNormalise(data: NormaliseJobData): Promise<string> {
  return sendJob(getDb(), queueName("normalise"), data);
}
