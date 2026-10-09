import { createDb } from "@enrich/db";
import { EnvError, getEnv, loadRootEnvFile } from "@enrich/shared/env";
import { createLogger } from "@enrich/shared/logger";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { startHeartbeat } from "./heartbeat";
import { registerAllJobs } from "./jobs";
import { createBoss, ensureQueues } from "./queue";

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
const boss = createBoss(env.DATABASE_URL);

boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
boss.on("warning", (warning) => logger.warn({ warning }, "pg-boss warning"));

await boss.start();
await ensureQueues(boss);
await registerAllJobs({ db, boss, env, logger });
const stopHeartbeat = startHeartbeat(db, logger, { workerId });

logger.info({ workerId, dryRun: env.GLOBAL_DRY_RUN }, "worker started");

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker stopping");
  stopHeartbeat();
  await boss.stop({ graceful: true, timeout: 30_000 });
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
