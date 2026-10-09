import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { clients } from "./clients";
import { eventSource } from "./enums";

export const rawEvents = pgTable(
  "raw_events",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    source: eventSource("source").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [index("raw_events_client_source_received_idx").on(t.clientId, t.source, t.receivedAt)],
);
