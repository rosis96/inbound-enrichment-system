import { decimal, index, int, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { id, json, timestamps, uuidRef } from "./_shared";
import { contacts } from "./contacts";
import { stepStatus } from "./enums";
import { leads } from "./leads";

/** Audit trail: one row per pipeline step execution. */
export const enrichmentSteps = mysqlTable(
  "enrichment_steps",
  {
    id: id(),
    leadId: uuidRef("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    contactId: uuidRef("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    step: varchar("step", { length: 50 }).notNull(),
    provider: varchar("provider", { length: 100 }).notNull(),
    status: stepStatus("status").notNull(),
    input: json("input").$type<unknown>(),
    output: json("output").$type<unknown>(),
    error: text("error"),
    costUsd: decimal("cost_usd", { precision: 10, scale: 5, mode: "number" }).notNull().default(0),
    durationMs: int("duration_ms"),
    attempt: int("attempt").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    index("enrichment_steps_lead_created_idx").on(t.leadId, t.createdAt),
    index("enrichment_steps_provider_created_idx").on(t.provider, t.createdAt),
  ],
);
