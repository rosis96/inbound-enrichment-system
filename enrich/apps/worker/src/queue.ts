import { QUEUE_NAMES, QUEUE_RETRY, type PipelineStep, queueName } from "@enrich/shared";
import { PgBoss } from "pg-boss";
import type { z } from "zod";
import type { JobContext, WorkerContext } from "./context";

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString, application_name: "enrich-worker" });
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of QUEUE_NAMES) {
    const existing = await boss.getQueue(name);
    if (existing) await boss.updateQueue(name, QUEUE_RETRY);
    else await boss.createQueue(name, QUEUE_RETRY);
  }
}

export interface JobDefinition<Schema extends z.ZodType> {
  step: PipelineStep;
  schema: Schema;
  handler: (data: z.output<Schema>, ctx: JobContext) => Promise<void>;
}

export async function registerJob<Schema extends z.ZodType>(
  ctx: WorkerContext,
  definition: JobDefinition<Schema>,
): Promise<void> {
  const name = queueName(definition.step);
  await ctx.boss.work<unknown>(name, { localConcurrency: 2, includeMetadata: true }, async (jobs) => {
    for (const job of jobs) {
      const logger = ctx.logger.child({ jobId: job.id, step: definition.step });
      const parsed = definition.schema.safeParse(job.data);
      if (!parsed.success) {
        // Malformed payloads can never succeed, so complete without retrying.
        logger.error({ issues: parsed.error.issues }, "invalid job payload, dropping");
        continue;
      }
      const ids = pickIds(parsed.data);
      await definition.handler(parsed.data, {
        ...ctx,
        logger: logger.child(ids),
        jobId: job.id,
        attempt: job.retryCount + 1,
      });
    }
  });
}

function pickIds(data: unknown): { leadId?: string; rawEventId?: string } {
  if (typeof data !== "object" || data === null) return {};
  const ids: { leadId?: string; rawEventId?: string } = {};
  if ("leadId" in data && typeof data.leadId === "string") ids.leadId = data.leadId;
  if ("rawEventId" in data && typeof data.rawEventId === "string") ids.rawEventId = data.rawEventId;
  return ids;
}
