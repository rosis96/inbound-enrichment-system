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
import { pgEnum } from "drizzle-orm/pg-core";

export const clientStatus = pgEnum("client_status", CLIENT_STATUSES);
export const eventSource = pgEnum("event_source", EVENT_SOURCES);
export const crawlSource = pgEnum("crawl_source", CRAWL_SOURCES);
export const intentLevel = pgEnum("intent_level", INTENT_LEVELS);
export const leadStatus = pgEnum("lead_status", LEAD_STATUSES);
export const emailStatus = pgEnum("email_status", EMAIL_STATUSES);
export const outreachStatus = pgEnum("outreach_status", OUTREACH_STATUSES);
export const stepStatus = pgEnum("step_status", STEP_STATUSES);
export const suppressionKind = pgEnum("suppression_kind", SUPPRESSION_KINDS);
export const suppressionReason = pgEnum("suppression_reason", SUPPRESSION_REASONS);
export const suppressionSource = pgEnum("suppression_source", SUPPRESSION_SOURCES);
export const promptKey = pgEnum("prompt_key", PROMPT_KEYS);
