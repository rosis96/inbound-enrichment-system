import { index, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { id, json, timestamps, utcDatetime, uuidRef } from "./_shared";
import { clients } from "./clients";
import { contacts } from "./contacts";
import { rawEvents } from "./events";

export const outreachEvents = mysqlTable(
  "outreach_events",
  {
    id: id(),
    clientId: uuidRef("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contactId: uuidRef("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    rawEventId: uuidRef("raw_event_id")
      .notNull()
      .references(() => rawEvents.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    campaignId: varchar("campaign_id", { length: 64 }),
    leadEmail: varchar("lead_email", { length: 320 }),
    occurredAt: utcDatetime("occurred_at").notNull(),
    payload: json("payload").$type<unknown>().notNull(),
    ...timestamps(),
  },
  (t) => [
    index("outreach_events_client_occurred_idx").on(t.clientId, t.occurredAt),
    index("outreach_events_contact_idx").on(t.contactId),
  ],
);
