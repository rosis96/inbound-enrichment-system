import type { PersonalisationMeta } from "@enrich/shared";
import { boolean, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { clients } from "./clients";
import { emailStatus, outreachStatus } from "./enums";
import { leads } from "./leads";

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    fullName: text("full_name"),
    title: text("title"),
    seniority: text("seniority"),
    linkedinUrl: text("linkedin_url"),
    email: text("email"),
    emailStatus: emailStatus("email_status"),
    // `happierleads` or `finder:<provider name>`
    emailSource: text("email_source"),
    selected: boolean("selected").notNull().default(false),
    firstLine: text("first_line"),
    subjectLine: text("subject_line"),
    personalisationMeta: jsonb("personalisation_meta").$type<PersonalisationMeta>(),
    instantlyLeadId: text("instantly_lead_id"),
    outreachStatus: outreachStatus("outreach_status").notNull().default("not_sent"),
    ...timestamps(),
  },
  (t) => [index("contacts_client_email_idx").on(t.clientId, t.email), index("contacts_lead_idx").on(t.leadId)],
);
