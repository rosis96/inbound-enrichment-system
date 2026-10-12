import { index, int, mysqlEnum, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { id, json, timestamps, utcDatetime } from "./_shared";

export const JOB_STATES = ["created", "active", "completed", "failed"] as const;

/** Job queue (replaces pg-boss). Workers claim rows with `UPDATE … ORDER BY … LIMIT 1`; see src/queue.ts. */
export const jobs = mysqlTable(
  "jobs",
  {
    id: id(),
    queue: varchar("queue", { length: 64 }).notNull(),
    data: json("data").$type<unknown>().notNull(),
    state: mysqlEnum("state", JOB_STATES).notNull().default("created"),
    retryCount: int("retry_count").notNull().default(0),
    retryLimit: int("retry_limit").notNull(),
    startAfter: utcDatetime("start_after")
      .notNull()
      .$defaultFn(() => new Date()),
    // Random per claim, so the claiming worker can find the row it just locked.
    claimToken: varchar("claim_token", { length: 36 }),
    lockedBy: varchar("locked_by", { length: 200 }),
    lockedAt: utcDatetime("locked_at"),
    lastError: text("last_error"),
    completedAt: utcDatetime("completed_at"),
    ...timestamps(),
  },
  (t) => [
    index("jobs_queue_state_start_idx").on(t.queue, t.state, t.startAfter),
    index("jobs_claim_token_idx").on(t.claimToken),
    index("jobs_state_locked_idx").on(t.state, t.lockedAt),
  ],
);
