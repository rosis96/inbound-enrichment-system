import { claimJob, completeJob, failJob, purgeFinishedJobs, reclaimStaleJobs, type Job } from "@enrich/db";
import { type PipelineStep, queueName } from "@enrich/shared";
import { setTimeout as sleep } from "node:timers/promises";
import type { z } from "zod";
import type { JobContext, WorkerContext } from "./context";

export interface JobDefinition<Schema extends z.ZodType = z.ZodType> {
  step: PipelineStep;
  schema: Schema;
  handler: (data: z.output<Schema>, ctx: JobContext) => Promise<void>;
}

export interface QueueWorkerOptions {
  /** Jobs run at once, across all queues. */
  concurrency?: number;
  /** Wait between polls when every queue is empty. */
  pollMs?: number;
  /** An `active` job locked longer than this is assumed abandoned and requeued. */
  staleAfterMs?: number;
  /** Finished jobs are deleted after this long. */
  keepFinishedMs?: number;
}

const MAINTENANCE_INTERVAL_MS = 60_000;

/** Polls the steps' queues in the `jobs` table. Returns a stop function that waits for running jobs. */
export function startQueueWorker(
  ctx: WorkerContext,
  definitions: JobDefinition[],
  options: QueueWorkerOptions = {},
): () => Promise<void> {
  const { concurrency = 4, pollMs = 1000, staleAfterMs = 15 * 60_000, keepFinishedMs = 7 * 24 * 3_600_000 } = options;
  const controller = new AbortController();
  const { signal } = controller;

  const pause = (ms: number) => sleep(ms, undefined, { signal }).catch(() => undefined);

  const byQueue = new Map(definitions.map((definition) => [queueName(definition.step) as string, definition]));
  const queues = [...byQueue.keys()];

  async function loop(): Promise<void> {
    while (!signal.aborted) {
      let job: Job | undefined;
      try {
        job = await claimJob(ctx.db, queues, ctx.workerId);
      } catch (error) {
        ctx.logger.error({ err: error }, "failed to claim job");
        await pause(pollMs * 5);
        continue;
      }
      if (!job) {
        await pause(pollMs);
        continue;
      }
      await runJob(byQueue.get(job.queue)!, job);
    }
  }

  async function runJob(definition: JobDefinition, job: Job): Promise<void> {
    const logger = ctx.logger.child({ jobId: job.id, step: definition.step });
    const parsed = definition.schema.safeParse(job.data);
    if (!parsed.success) {
      // Malformed payloads can never succeed, so complete without retrying.
      logger.error({ issues: parsed.error.issues }, "invalid job payload, dropping");
      await completeJob(ctx.db, job.id);
      return;
    }
    const jobLogger = logger.child(pickIds(parsed.data));
    try {
      await definition.handler(parsed.data, { ...ctx, logger: jobLogger, jobId: job.id, attempt: job.retryCount + 1 });
      await completeJob(ctx.db, job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = await failJob(ctx.db, job, message).catch((failError: unknown) => {
        jobLogger.error({ err: failError }, "could not record job failure");
        return "unknown";
      });
      jobLogger.error({ err: error, attempt: job.retryCount + 1, outcome }, "job failed");
    }
  }

  async function maintenance(): Promise<void> {
    try {
      const requeued = await reclaimStaleJobs(ctx.db, staleAfterMs);
      if (requeued > 0) ctx.logger.warn({ requeued }, "requeued jobs abandoned by a stopped worker");
      await purgeFinishedJobs(ctx.db, keepFinishedMs);
    } catch (error) {
      ctx.logger.error({ err: error }, "queue maintenance failed");
    }
  }

  void maintenance();
  const maintenanceTimer = setInterval(() => void maintenance(), MAINTENANCE_INTERVAL_MS);
  const loops = Array.from({ length: concurrency }, () => loop());

  return async () => {
    clearInterval(maintenanceTimer);
    controller.abort();
    await Promise.allSettled(loops);
  };
}

function pickIds(data: unknown): { leadId?: string; rawEventId?: string } {
  if (typeof data !== "object" || data === null) return {};
  const ids: { leadId?: string; rawEventId?: string } = {};
  if ("leadId" in data && typeof data.leadId === "string") ids.leadId = data.leadId;
  if ("rawEventId" in data && typeof data.rawEventId === "string") ids.rawEventId = data.rawEventId;
  return ids;
}
