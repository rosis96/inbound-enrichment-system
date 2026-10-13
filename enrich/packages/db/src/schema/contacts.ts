import type { PersonalisationMeta } from "@enrich/shared";
import { boolean, index, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { id, json, timestamps, uuidRef } from "./_shared";
import { clients } from "./clients";
import { emailStatus, outreachStatus } from "./enums";
import { leads } from "./leads";

export const contacts = mysqlTable(
  "contacts",
  {
    id: id(),
    leadId: uuidRef("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    clientId: uuidRef("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    firstName: varchar("first_name", { length: 255 }),
    lastName: varchar("last_name", { length: 255 }),
    fullName: varchar("full_name", { length: 255 }),
    title: varchar("title", { length: 255 }),
    seniority: varchar("seniority", { length: 50 }),
    linkedinUrl: varchar("linkedin_url", { length: 500 }),
    email: varchar("email", { length: 320 }),
    emailStatus: emailStatus("email_status"),
    // `happierleads` or `finder:<provider name>`
    emailSource: varchar("email_source", { length: 100 }),
    selected: boolean("selected").notNull().default(false),
    firstLine: text("first_line"),
    subjectLine: varchar("subject_line", { length: 255 }),
    personalisationMeta: json("personalisation_meta").$type<PersonalisationMeta>(),
    // AI variables by name, e.g. { personalized_first_line: "..." }; replaces first_line / subject_line.
    aiVariables: json("ai_variables").$type<Record<string, string>>(),
    instantlyLeadId: varchar("instantly_lead_id", { length: 64 }),
    outreachStatus: outreachStatus("outreach_status").notNull().default("not_sent"),
    ...timestamps(),
  },
  (t) => [index("contacts_client_email_idx").on(t.clientId, t.email), index("contacts_lead_idx").on(t.leadId)],
);
