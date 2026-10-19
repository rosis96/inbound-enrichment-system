import { createDb } from "@enrich/db";
import { EnvError, getEnv, loadRootEnvFile } from "@enrich/shared/env";
import { createLogger } from "@enrich/shared/logger";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { startActiveCampaignSync } from "./activecampaign-sync";
import { startBlocklistSync } from "./blocklist-sync";
import { startHeartbeat } from "./heartbeat";
import { jobDefinitions } from "./jobs";
import { startQueueWorker } from "./queue";

loadRootEnvFile();

let env;
try {
  env = getEnv();
} catch (error) {
  if (error instanceof EnvError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const logger = createLogger({ name: "worker", level: env.LOG_LEVEL });
const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const { db, pool } = createDb(env.DATABASE_URL);

const stopQueue = startQueueWorker({ db, env, logger, workerId }, jobDefinitions);
const stopHeartbeat = startHeartbeat(db, logger, { workerId });
const stopBlocklistSync = startBlocklistSync({ db, env, logger, workerId });
const stopActiveCampaignSync = startActiveCampaignSync({ db, env, logger, workerId });

logger.info({ workerId, dryRun: env.GLOBAL_DRY_RUN }, "worker started");

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker stopping");
  stopHeartbeat();
  stopBlocklistSync();
  stopActiveCampaignSync();
  // Let running jobs finish, but do not hang forever.
  await Promise.race([stopQueue(), new Promise((resolve) => setTimeout(resolve, 30_000))]);
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
