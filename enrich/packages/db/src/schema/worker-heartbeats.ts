import { int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { id, timestamps, utcDatetime } from "./_shared";

export const workerHeartbeats = mysqlTable("worker_heartbeats", {
  id: id(),
  workerId: varchar("worker_id", { length: 200 }).notNull().unique(),
  hostname: varchar("hostname", { length: 255 }).notNull(),
  pid: int("pid").notNull(),
  startedAt: utcDatetime("started_at").notNull(),
  lastBeatAt: utcDatetime("last_beat_at").notNull(),
  ...timestamps(),
});
