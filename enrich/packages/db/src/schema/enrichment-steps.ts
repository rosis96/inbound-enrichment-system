import { index, integer, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { contacts } from "./contacts";
import { stepStatus } from "./enums";
import { leads } from "./leads";

/** Audit trail: one row per pipeline step execution. */
export const enrichmentSteps = pgTable(
  "enrichment_steps",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    step: text("step").notNull(),
    provider: text("provider").notNull(),
    status: stepStatus("status").notNull(),
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    error: text("error"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5, mode: "number" }).notNull().default(0),
    durationMs: integer("duration_ms"),
    attempt: integer("attempt").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    index("enrichment_steps_lead_created_idx").on(t.leadId, t.createdAt),
    index("enrichment_steps_provider_created_idx").on(t.provider, t.createdAt),
  ],
);
