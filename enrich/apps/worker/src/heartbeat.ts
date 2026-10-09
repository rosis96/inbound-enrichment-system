import { workerHeartbeats, type Database } from "@enrich/db";
import type { Logger } from "@enrich/shared/logger";
import { hostname } from "node:os";

export const HEARTBEAT_INTERVAL_MS = 60_000;

export async function recordHeartbeat(db: Database, workerId: string, startedAt: Date): Promise<void> {
  const now = new Date();
  await db
    .insert(workerHeartbeats)
    .values({ workerId, hostname: hostname(), pid: process.pid, startedAt, lastBeatAt: now })
    .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastBeatAt: now } });
}

/** Writes a heartbeat now and every interval. Returns a stop function. */
export function startHeartbeat(
  db: Database,
  logger: Logger,
  options: { workerId: string; intervalMs?: number },
): () => void {
  const startedAt = new Date();
  const beat = async () => {
    try {
      await recordHeartbeat(db, options.workerId, startedAt);
      logger.info({ workerId: options.workerId }, "heartbeat");
    } catch (error) {
      logger.error({ err: error }, "heartbeat failed");
    }
  };
  void beat();
  const timer = setInterval(beat, options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}
