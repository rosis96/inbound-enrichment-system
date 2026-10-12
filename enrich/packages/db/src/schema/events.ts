import { index, mysqlTable, text } from "drizzle-orm/mysql-core";
import { id, json, timestamps, utcDatetime, uuidRef } from "./_shared";
import { clients } from "./clients";
import { eventSource } from "./enums";

export const rawEvents = mysqlTable(
  "raw_events",
  {
    id: id(),
    clientId: uuidRef("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    source: eventSource("source").notNull(),
    payload: json("payload").$type<unknown>().notNull(),
    receivedAt: utcDatetime("received_at")
      .notNull()
      .$defaultFn(() => new Date()),
    processedAt: utcDatetime("processed_at"),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [index("raw_events_client_source_received_idx").on(t.clientId, t.source, t.receivedAt)],
);
