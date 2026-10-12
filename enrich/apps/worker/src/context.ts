import type { Database } from "@enrich/db";
import type { Env } from "@enrich/shared/env";
import type { Logger } from "@enrich/shared/logger";

/** Dependencies handed to every job handler. */
export interface WorkerContext {
  db: Database;
  env: Env;
  logger: Logger;
  workerId: string;
}

/** Per-job context: the logger is bound to jobId, step and leadId/rawEventId. */
export interface JobContext extends WorkerContext {
  jobId: string;
  attempt: number;
}
