import { z } from "zod";

export const INTENT_LEVELS = ["high", "medium", "low"] as const;
export const IntentLevel = z.enum(INTENT_LEVELS);
export type IntentLevel = z.infer<typeof IntentLevel>;

export const LeadPage = z.object({
  url: z.string(),
  path: z.string(),
  title: z.string().optional(),
  at: z.string().optional(),
});
export type LeadPage = z.infer<typeof LeadPage>;

export const IcpReason = z.object({
  factor: z.string(),
  points: z.number(),
  max: z.number(),
  detail: z.string(),
});
export type IcpReason = z.infer<typeof IcpReason>;

export const LEAD_STATUSES = [
  "received",
  "normalised",
  "gated_out",
  "below_icp",
  "no_contact",
  "no_valid_email",
  "researched",
  "personalised",
  "awaiting_review",
  "approved",
  "rejected",
  "pushed",
  "dry_run_complete",
  "failed",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const EMAIL_STATUSES = ["valid", "invalid", "catch_all", "unknown", "not_found"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const OUTREACH_STATUSES = [
  "not_sent",
  "queued",
  "sent",
  "replied",
  "bounced",
  "unsubscribed",
  "interested",
  "not_interested",
  "meeting_booked",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const SUPPRESSION_KINDS = ["email", "domain"] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

export const SUPPRESSION_REASONS = [
  "customer",
  "open_deal",
  "competitor",
  "do_not_contact",
  "unsubscribed",
  "bounced",
  "replied",
  "manual",
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const SUPPRESSION_SOURCES = ["csv", "instantly", "manual"] as const;
export type SuppressionSource = (typeof SUPPRESSION_SOURCES)[number];

export const STEP_STATUSES = ["ok", "skipped", "failed"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const EVENT_SOURCES = ["happierleads", "instantly"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const CRAWL_SOURCES = ["fetch", "firecrawl"] as const;
export type CrawlSource = (typeof CRAWL_SOURCES)[number];

export const PROMPT_KEYS = ["company_summary", "first_line"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export const CLIENT_STATUSES = ["active", "paused"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const PersonalisationMeta = z.object({
  promptVersion: z.number().int(),
  model: z.string(),
});
export type PersonalisationMeta = z.infer<typeof PersonalisationMeta>;

/** Key in a raw payload marking a lead sent from the Test lead page, with its options. */
export const TEST_PAYLOAD_KEY = "_enrichTest";

export const TestLeadFlags = z.object({
  /** Save the Instantly request instead of sending it, whatever the client's switch says. */
  dryRun: z.boolean().default(true),
  /** Ignore the "contacted recently" gate. */
  skipDedupe: z.boolean().default(false),
  /** Crawl and summarise the website again even if a recent result is cached. */
  freshResearch: z.boolean().default(false),
});
export type TestLeadFlags = z.infer<typeof TestLeadFlags>;

/** Test-lead options from a raw payload, or null for real webhooks. */
export function testLeadFlags(payload: unknown): TestLeadFlags | null {
  if (!payload || typeof payload !== "object" || !(TEST_PAYLOAD_KEY in payload)) return null;
  const parsed = TestLeadFlags.safeParse((payload as Record<string, unknown>)[TEST_PAYLOAD_KEY]);
  return parsed.success ? parsed.data : null;
}
