import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";

export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: id(),
  workerId: text("worker_id").notNull().unique(),
  hostname: text("hostname").notNull(),
  pid: integer("pid").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastBeatAt: timestamp("last_beat_at", { withTimezone: true }).notNull(),
  ...timestamps(),
});
