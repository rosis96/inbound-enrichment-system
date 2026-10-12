import type { CompanySummary } from "@enrich/shared";
import { sql } from "drizzle-orm";
import { check, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { id, json, timestamps, utcDatetime } from "./_shared";
import { crawlSource } from "./enums";

/** Shared cache across clients, keyed by normalised domain (lowercase, no `www.`). */
export const companies = mysqlTable(
  "companies",
  {
    id: id(),
    domain: varchar("domain", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }),
    industry: varchar("industry", { length: 255 }),
    employeeRange: varchar("employee_range", { length: 50 }),
    revenueRange: varchar("revenue_range", { length: 50 }),
    country: varchar("country", { length: 100 }),
    linkedinUrl: varchar("linkedin_url", { length: 500 }),
    crawlText: text("crawl_text"),
    crawlSource: crawlSource("crawl_source"),
    crawledAt: utcDatetime("crawled_at"),
    summary: json("summary").$type<CompanySummary>(),
    summaryModel: varchar("summary_model", { length: 100 }),
    summarisedAt: utcDatetime("summarised_at"),
    ...timestamps(),
  },
  (t) => [
    check("companies_domain_normalised", sql`${t.domain} = lower(${t.domain}) and ${t.domain} not like 'www.%'`),
  ],
);
