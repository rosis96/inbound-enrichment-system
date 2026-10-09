import type { IcpReason, LeadPage } from "@enrich/shared";
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { clients } from "./clients";
import { companies } from "./companies";
import { intentLevel, leadStatus } from "./enums";
import { rawEvents } from "./events";

export const leads = pgTable(
  "leads",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    rawEventId: uuid("raw_event_id")
      .notNull()
      .references(() => rawEvents.id),
    visitedAt: timestamp("visited_at", { withTimezone: true }),
    pages: jsonb("pages").$type<LeadPage[]>().notNull().default([]),
    referrer: text("referrer"),
    session: jsonb("session").$type<unknown>(),
    intentTopic: text("intent_topic"),
    intentLevel: intentLevel("intent_level"),
    icpScore: integer("icp_score"),
    icpReasons: jsonb("icp_reasons").$type<IcpReason[]>(),
    status: leadStatus("status").notNull().default("received"),
    skipReason: text("skip_reason"),
    campaignId: text("campaign_id"),
    ...timestamps(),
  },
  (t) => [
    unique("leads_client_raw_event_unique").on(t.clientId, t.rawEventId),
    index("leads_client_status_created_idx").on(t.clientId, t.status, t.createdAt),
    index("leads_client_company_idx").on(t.clientId, t.companyId),
  ],
);
