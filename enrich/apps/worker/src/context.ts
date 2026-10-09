import type { Database } from "@enrich/db";
import type { Env } from "@enrich/shared/env";
import type { Logger } from "@enrich/shared/logger";
import type { PgBoss } from "pg-boss";

/** Dependencies handed to every job handler. */
export interface WorkerContext {
  db: Database;
  boss: PgBoss;
  env: Env;
  logger: Logger;
}

/** Per-job context: the logger is bound to jobId, step and leadId/rawEventId. */
export interface JobContext extends WorkerContext {
  jobId: string;
  attempt: number;
}
