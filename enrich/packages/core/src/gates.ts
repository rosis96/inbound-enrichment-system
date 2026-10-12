import type { ClientSettings, SuppressionKind, SuppressionReason } from "@enrich/shared";
import { domainInList, emailDomain } from "./normalise";

export interface SuppressionEntry {
  kind: SuppressionKind;
  value: string;
  reason: SuppressionReason;
}

export interface GateContact {
  id: string;
  email: string | null;
}

export interface DuplicateLead {
  id: string;
  status: string;
  createdAt: Date;
}

export interface GateInput {
  domain: string;
  contacts: GateContact[];
  /** Active (non-expired) suppression rows for the client. */
  suppression: SuppressionEntry[];
  /** Most recent other lead for the same client and company within `dedupeDays`, if any. */
  duplicate: DuplicateLead | null;
  settings: ClientSettings;
}

export interface GateResult {
  passed: boolean;
  /** Machine-readable reason when the whole lead is gated out, e.g. `suppressed_domain:competitor`. */
  reason?: string;
  detail?: string;
  /** Contacts that may be emailed. Contacts without an email are not eligible. */
  eligibleContactIds: string[];
  excludedContacts: { id: string; email: string | null; reason: string }[];
}

function fail(reason: string, detail: string, input: GateInput): GateResult {
  return {
    passed: false,
    reason,
    detail,
    eligibleContactIds: [],
    excludedContacts: input.contacts.map((c) => ({ id: c.id, email: c.email, reason: "lead_gated_out" })),
  };
}

function domainSuppression(domain: string, suppression: SuppressionEntry[]): SuppressionEntry | undefined {
  return suppression.find((row) => row.kind === "domain" && domainInList(domain, [row.value]));
}

export function evaluateGates(input: GateInput): GateResult {
  const { domain, settings } = input;

  if (domainInList(domain, settings.ownDomains)) {
    return fail("own_domain", `${domain} is one of the client's own domains`, input);
  }
  if (domainInList(domain, settings.freeEmailDomains)) {
    return fail("free_email_domain", `${domain} is a free email provider, not a company`, input);
  }
  const suppressedDomain = domainSuppression(domain, input.suppression);
  if (suppressedDomain) {
    return fail(
      `suppressed_domain:${suppressedDomain.reason}`,
      `${domain} matches suppressed domain ${suppressedDomain.value} (${suppressedDomain.reason})`,
      input,
    );
  }
  if (input.duplicate) {
    return fail(
      "duplicate",
      `lead ${input.duplicate.id} for ${domain} reached ${input.duplicate.status} on ${input.duplicate.createdAt.toISOString()}, within ${settings.dedupeDays} days`,
      input,
    );
  }

  const eligibleContactIds: string[] = [];
  const excludedContacts: GateResult["excludedContacts"] = [];
  for (const contact of input.contacts) {
    const reason = contactExclusion(contact.email, input);
    if (reason) excludedContacts.push({ id: contact.id, email: contact.email, reason });
    else eligibleContactIds.push(contact.id);
  }
  return { passed: true, eligibleContactIds, excludedContacts };
}

function contactExclusion(email: string | null, input: GateInput): string | undefined {
  if (!email) return "no_email";
  const suppressedEmail = input.suppression.find((row) => row.kind === "email" && row.value === email);
  if (suppressedEmail) return `suppressed_email:${suppressedEmail.reason}`;
  const domain = emailDomain(email);
  const suppressedDomain = domainSuppression(domain, input.suppression);
  if (suppressedDomain) return `suppressed_domain:${suppressedDomain.reason}`;
  if (domainInList(domain, input.settings.freeEmailDomains)) return "free_email_domain";
  return undefined;
}
