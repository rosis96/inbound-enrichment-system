import type { PersonalisationPlan, VariableResult } from "@enrich/shared";
import { decimal, index, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { id, json, timestamps, uuidRef } from "./_shared";
import { clients } from "./clients";
import { companies } from "./companies";

export interface VariableTestContact {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
}

/** A run of the Variable lab: one prospect website, its research plan and every generated variable. */
export const variableTests = mysqlTable(
  "variable_tests",
  {
    id: id(),
    clientId: uuidRef("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    companyId: uuidRef("company_id")
      .notNull()
      .references(() => companies.id),
    contact: json("contact").$type<VariableTestContact>().notNull(),
    plan: json("plan").$type<PersonalisationPlan>(),
    // Plan verification: unverified details and dropped services, shown with the plan.
    planCheck: json("plan_check").$type<unknown>(),
    planError: text("plan_error"),
    results: json("results")
      .$type<Record<string, VariableResult>>()
      .notNull()
      .$defaultFn(() => ({})),
    error: text("error"),
    model: varchar("model", { length: 100 }),
    // Total spend of every planner and writer call in this test.
    costUsd: decimal("cost_usd", { precision: 10, scale: 5, mode: "number" }).notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("variable_tests_client_created_idx").on(t.clientId, t.createdAt)],
);
