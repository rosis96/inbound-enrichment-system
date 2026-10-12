import {
  CLIENT_STATUSES,
  CRAWL_SOURCES,
  EMAIL_STATUSES,
  EVENT_SOURCES,
  INTENT_LEVELS,
  LEAD_STATUSES,
  OUTREACH_STATUSES,
  PROMPT_KEYS,
  STEP_STATUSES,
  SUPPRESSION_KINDS,
  SUPPRESSION_REASONS,
  SUPPRESSION_SOURCES,
} from "@enrich/shared";
import { mysqlEnum } from "drizzle-orm/mysql-core";

// MySQL enums are per column, so these are column factories: `leadStatus("status")`.
export const clientStatus = (name: string) => mysqlEnum(name, CLIENT_STATUSES);
export const eventSource = (name: string) => mysqlEnum(name, EVENT_SOURCES);
export const crawlSource = (name: string) => mysqlEnum(name, CRAWL_SOURCES);
export const intentLevel = (name: string) => mysqlEnum(name, INTENT_LEVELS);
export const leadStatus = (name: string) => mysqlEnum(name, LEAD_STATUSES);
export const emailStatus = (name: string) => mysqlEnum(name, EMAIL_STATUSES);
export const outreachStatus = (name: string) => mysqlEnum(name, OUTREACH_STATUSES);
export const stepStatus = (name: string) => mysqlEnum(name, STEP_STATUSES);
export const suppressionKind = (name: string) => mysqlEnum(name, SUPPRESSION_KINDS);
export const suppressionReason = (name: string) => mysqlEnum(name, SUPPRESSION_REASONS);
export const suppressionSource = (name: string) => mysqlEnum(name, SUPPRESSION_SOURCES);
export const promptKey = (name: string) => mysqlEnum(name, PROMPT_KEYS);
