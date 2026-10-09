import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { clients } from "./clients";
import { contacts } from "./contacts";
import { rawEvents } from "./events";

export const outreachEvents = pgTable(
  "outreach_events",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    rawEventId: uuid("raw_event_id")
      .notNull()
      .references(() => rawEvents.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    campaignId: text("campaign_id"),
    leadEmail: text("lead_email"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    ...timestamps(),
  },
  (t) => [
    index("outreach_events_client_occurred_idx").on(t.clientId, t.occurredAt),
    index("outreach_events_contact_idx").on(t.contactId),
  ],
);
