import { QUEUE_RETRY } from "@enrich/shared";
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Executor } from "./client";
import { jobs } from "./schema";

export type Job = typeof jobs.$inferSelect;

/** Adds a job. Pass a transaction as `db` to enqueue atomically with other writes. */
export async function sendJob(
  db: Executor,
  queue: string,
  data: unknown,
  options: { retryLimit?: number; startAfter?: Date } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(jobs).values({
    id,
    queue,
    data,
    retryLimit: options.retryLimit ?? QUEUE_RETRY.retryLimit,
    startAfter: options.startAfter ?? new Date(),
  });
  return id;
}

/**
 * Atomically claims the oldest due job on any of `queues`, or returns undefined.
 * A single-row `UPDATE … ORDER BY … LIMIT 1` is atomic on InnoDB, so two workers never claim the
 * same job; this avoids `SKIP LOCKED`, which MariaDB only has from 10.6.
 */
export async function claimJob(db: Executor, queues: string[], workerId: string): Promise<Job | undefined> {
  const claimToken = randomUUID();
  const now = new Date();
  const [result] = await db
    .update(jobs)
    .set({ state: "active", claimToken, lockedBy: workerId, lockedAt: now })
    .where(and(inArray(jobs.queue, queues), eq(jobs.state, "created"), lte(jobs.startAfter, now)))
    .orderBy(asc(jobs.startAfter))
    .limit(1);
  if (result.affectedRows === 0) return undefined;
  const [job] = await db.select().from(jobs).where(eq(jobs.claimToken, claimToken));
  return job;
}

export async function completeJob(db: Executor, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ state: "completed", completedAt: new Date(), claimToken: null })
    .where(eq(jobs.id, jobId));
}

/** Seconds to wait before retry number `retryCount + 1`: exponential, capped. */
export function retryDelaySeconds(retryCount: number): number {
  const { retryDelay, retryBackoff, retryDelayMax } = QUEUE_RETRY;
  return Math.min(retryDelayMax, retryBackoff ? retryDelay * 2 ** retryCount : retryDelay);
}

/** Schedules a retry with backoff, or marks the job failed once retries are used up. */
export async function failJob(db: Executor, job: Job, error: string): Promise<"retry" | "failed"> {
  const lastError = error.slice(0, 5000);
  if (job.retryCount < job.retryLimit) {
    await db
      .update(jobs)
      .set({
        state: "created",
        retryCount: job.retryCount + 1,
        startAfter: new Date(Date.now() + retryDelaySeconds(job.retryCount) * 1000),
        claimToken: null,
        lockedBy: null,
        lockedAt: null,
        lastError,
      })
      .where(eq(jobs.id, job.id));
    return "retry";
  }
  await db
    .update(jobs)
    .set({ state: "failed", completedAt: new Date(), claimToken: null, lastError })
    .where(eq(jobs.id, job.id));
  return "failed";
}

/** Returns jobs left `active` by a worker that died (locked longer than `staleAfterMs`) to the queue. */
export async function reclaimStaleJobs(db: Executor, staleAfterMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const stale = and(eq(jobs.state, "active"), lt(jobs.lockedAt, cutoff));
  const [retried] = await db
    .update(jobs)
    .set({
      state: "created",
      retryCount: sql`${jobs.retryCount} + 1`,
      startAfter: new Date(),
      claimToken: null,
      lockedBy: null,
      lockedAt: null,
      lastError: "worker stopped while the job was active",
    })
    .where(and(stale, lt(jobs.retryCount, jobs.retryLimit)));
  await db
    .update(jobs)
    .set({ state: "failed", completedAt: new Date(), claimToken: null, lastError: "worker stopped while the job was active" })
    .where(stale);
  return retried.affectedRows;
}

/** Deletes finished jobs older than `olderThanMs`. */
export async function purgeFinishedJobs(db: Executor, olderThanMs: number): Promise<void> {
  await db
    .delete(jobs)
    .where(and(inArray(jobs.state, ["completed", "failed"]), lt(jobs.completedAt, new Date(Date.now() - olderThanMs))));
}
