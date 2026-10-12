import type { IcpReason, LeadPage } from "@enrich/shared";
import { index, int, mysqlTable, text, unique, varchar } from "drizzle-orm/mysql-core";
import { id, json, timestamps, utcDatetime, uuidRef } from "./_shared";
import { clients } from "./clients";
import { companies } from "./companies";
import { intentLevel, leadStatus } from "./enums";
import { rawEvents } from "./events";

export const leads = mysqlTable(
  "leads",
  {
    id: id(),
    clientId: uuidRef("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    companyId: uuidRef("company_id")
      .notNull()
      .references(() => companies.id),
    rawEventId: uuidRef("raw_event_id")
      .notNull()
      .references(() => rawEvents.id),
    visitedAt: utcDatetime("visited_at"),
    pages: json("pages")
      .$type<LeadPage[]>()
      .notNull()
      .$defaultFn(() => []),
    referrer: text("referrer"),
    session: json("session").$type<unknown>(),
    intentTopic: varchar("intent_topic", { length: 255 }),
    intentLevel: intentLevel("intent_level"),
    icpScore: int("icp_score"),
    icpReasons: json("icp_reasons").$type<IcpReason[]>(),
    status: leadStatus("status").notNull().default("received"),
    skipReason: text("skip_reason"),
    campaignId: varchar("campaign_id", { length: 64 }),
    ...timestamps(),
  },
  (t) => [
    unique("leads_client_raw_event_unique").on(t.clientId, t.rawEventId),
    index("leads_client_status_created_idx").on(t.clientId, t.status, t.createdAt),
    index("leads_client_company_idx").on(t.clientId, t.companyId),
  ],
);
