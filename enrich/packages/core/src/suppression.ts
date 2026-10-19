import type { SuppressionKind } from "@enrich/shared";
import { domainInList, emailDomain, normaliseDomain, normaliseEmail } from "./normalise";

export interface ParsedSuppression {
  kind: SuppressionKind;
  value: string;
}

const HEADER_WORDS = /^(email|e-mail|domain|website|url|company|name|first ?name|last ?name|title|reason)$/i;

/**
 * Pulls suppressible values out of pasted text or a CSV: one entry per line, comma, semicolon or tab.
 * Emails stay emails; URLs and bare hosts become domains (`https://www.Acme.com/x` → `acme.com`).
 * Header cells and anything that is neither are returned in `skipped`.
 */
export function parseSuppressionEntries(text: string): { entries: ParsedSuppression[]; skipped: string[] } {
  const seen = new Set<string>();
  const entries: ParsedSuppression[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/[\r\n,;\t]+/)) {
    const cell = raw.trim().replace(/^["']|["']$/g, "").trim();
    if (!cell) continue;
    if (HEADER_WORDS.test(cell)) continue;
    const email = cell.includes("@") ? normaliseEmail(cell) : undefined;
    const entry: ParsedSuppression | undefined = email
      ? { kind: "email", value: email }
      : !cell.includes("@") && !/\s/.test(cell)
        ? (() => {
            const domain = normaliseDomain(cell);
            return domain ? { kind: "domain" as const, value: domain } : undefined;
          })()
        : undefined;
    if (!entry) {
      if (skipped.length < 50) skipped.push(cell);
      continue;
    }
    const key = `${entry.kind}:${entry.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return { entries, skipped };
}

export const BLOCKLIST_SCOPES = ["both", "email", "domain"] as const;
export type BlocklistScope = (typeof BLOCKLIST_SCOPES)[number];

export interface BlocklistContact {
  email?: string;
  /** From a website/domain field, or failing that the email's domain. */
  domain?: string;
}

// Whose email a field holds, when it is not the person who filled in the form or booked: Calendly's
// `event_memberships[].user_email`, Cal.com's `organizer.email`, HubSpot's `owner`, …
const NOT_THE_LEAD = /organi[sz]er|host|owner|membership|assignee|sender|team|^user|staff|agent|account|notify|recipient|replyto|admin/;
// Exact names only: a bare `url` is often the page the form sits on, i.e. the client's own site.
const WEBSITE_KEYS = new Set(["website", "websiteurl", "companywebsite", "companyurl", "companydomain", "domain", "webaddress"]);
// Keys whose string belongs to the parent's name: `{ email: { value: "…" } }`, `{ emails: ["…"] }`.
const VALUE_KEYS = new Set(["", "value", "answer"]);
const LABEL_KEYS = ["label", "name", "title", "key", "field"];

const fieldKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Name of a `{ label: "Work email", value: "…" }` field, as many form builders send their answers. */
function labelOf(value: object): string | undefined {
  const record = value as Record<string, unknown>;
  const label = LABEL_KEYS.map((k) => record[k]).find((v): v is string => typeof v === "string");
  return label === undefined ? undefined : fieldKey(label);
}

/**
 * Finds the lead's email and website in a form or booking tool's webhook, without knowing the tool:
 * the shallowest field whose name contains "email" (or is website, domain, …) and holds a valid value.
 * Fields and objects about the organiser, host, owner or team are skipped. Accepts a JSON body or
 * form fields, nested up to 5 levels (`payload.invitee.email`, `form_response.answers[].email`,
 * `fields[] = { label: "Email", value }`, …).
 */
export function parseBlocklistPayload(payload: unknown): BlocklistContact {
  let email: string | undefined;
  let website: string | undefined;
  let level: { key: string; value: unknown }[] = [{ key: "", value: payload }];
  for (let depth = 0; depth <= 5 && level.length > 0 && !(email && website); depth++) {
    const next: typeof level = [];
    for (const parent of level) {
      const { value } = parent;
      const fields: [string, unknown][] = Array.isArray(value)
        ? value.map((item) => ["", item])
        : value && typeof value === "object"
          ? Object.entries(value)
          : [];
      const label = value && typeof value === "object" && !Array.isArray(value) ? labelOf(value) : undefined;
      for (const [rawKey, child] of fields) {
        let key = fieldKey(rawKey);
        if (VALUE_KEYS.has(key)) key = label ?? parent.key;
        if (key && NOT_THE_LEAD.test(key)) continue;
        if (typeof child === "string") {
          if (!email && key.includes("email")) email = normaliseEmail(child);
          if (!website && WEBSITE_KEYS.has(key)) website = normaliseDomain(child);
        } else if (child && typeof child === "object") {
          next.push({ key, value: child });
        }
      }
    }
    level = next;
  }
  return { email, domain: website ?? (email ? emailDomain(email) : undefined) };
}

/**
 * Entries to suppress for one blocklisted lead. `both` blocks the email and the whole company; a free
 * email domain (gmail.com, …) is never blocked as a company, only the email itself.
 */
export function blocklistEntries(contact: BlocklistContact, scope: BlocklistScope, freeEmailDomains: readonly string[]): ParsedSuppression[] {
  const entries: ParsedSuppression[] = [];
  if (contact.email && scope !== "domain") entries.push({ kind: "email", value: contact.email });
  if (contact.domain && scope !== "email" && !domainInList(contact.domain, freeEmailDomains)) {
    entries.push({ kind: "domain", value: contact.domain });
  }
  // Asked for the domain only, but the lead used a personal address: the email is all there is to block.
  if (entries.length === 0 && contact.email) entries.push({ kind: "email", value: contact.email });
  return entries;
}
