import type { CompanySummary } from "@enrich/shared";
import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { crawlSource } from "./enums";

/** Shared cache across clients, keyed by normalised domain (lowercase, no `www.`). */
export const companies = pgTable(
  "companies",
  {
    id: id(),
    domain: text("domain").notNull().unique(),
    name: text("name"),
    industry: text("industry"),
    employeeRange: text("employee_range"),
    revenueRange: text("revenue_range"),
    country: text("country"),
    linkedinUrl: text("linkedin_url"),
    crawlText: text("crawl_text"),
    crawlSource: crawlSource("crawl_source"),
    crawledAt: timestamp("crawled_at", { withTimezone: true }),
    summary: jsonb("summary").$type<CompanySummary>(),
    summaryModel: text("summary_model"),
    summarisedAt: timestamp("summarised_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [check("companies_domain_normalised", sql`${t.domain} = lower(${t.domain}) and ${t.domain} not like 'www.%'`)],
);
