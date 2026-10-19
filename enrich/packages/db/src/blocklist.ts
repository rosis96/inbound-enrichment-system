import { suppressionMatch, type ParsedSuppression } from "@enrich/core";
import type { LeadStatus, SuppressionReason, SuppressionSource } from "@enrich/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { companies, contacts, leads, suppression } from "./schema";

/** Leads that already reached outreach; new blocklist entries move them to `suppressed`. */
const SENT: LeadStatus[] = ["pushed", "dry_run_complete"];

export interface AddToBlocklistInput {
  clientId: string;
  /** An entry's own `reason` and `note` win over the input's. */
  entries: (ParsedSuppression & { reason?: SuppressionReason; note?: string | null })[];
  reason: SuppressionReason;
  source: SuppressionSource;
  expiresAt: Date | null;
  note?: string | null;
}

/**
 * Adds or updates suppression entries for a client and marks the client's already-sent leads they match
 * as `suppressed`. New leads are stopped by the gates and push steps; the worker copies the entries to
 * the client's Instantly blocklist, which also stops leads that are already in a campaign.
 */
export async function addToBlocklist(db: Database, input: AddToBlocklistInput): Promise<{ suppressedLeads: number }> {
  const { clientId, source, expiresAt } = input;
  const entries = input.entries.map((e) => ({
    kind: e.kind,
    value: e.value,
    reason: e.reason ?? input.reason,
    note: (e.note ?? input.note)?.slice(0, 500) ?? null,
  }));
  // Insert in chunks so a large CSV stays within MySQL's packet limits.
  for (let i = 0; i < entries.length; i += 500) {
    await db
      .insert(suppression)
      .values(entries.slice(i, i + 500).map((e) => ({ clientId, ...e, source, expiresAt })))
      .onDuplicateKeyUpdate({
        set: {
          reason: sql`values(reason)`,
          expiresAt: sql`values(expires_at)`,
          note: sql`coalesce(values(note), note)`,
          // Not in Instantly (never synced, or removed there after expiring): try again on the next sync.
          instantlyCheckedAt: sql`if(instantly_entry_id is null, null, instantly_checked_at)`,
          instantlyError: sql`if(instantly_entry_id is null, null, instantly_error)`,
          updatedAt: new Date(),
        },
      });
  }
  return { suppressedLeads: await suppressSentLeads(db, clientId, entries) };
}

async function suppressSentLeads(
  db: Database,
  clientId: string,
  entries: (ParsedSuppression & { reason: SuppressionReason })[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const sent = await db
    .select({ id: leads.id, status: leads.status, domain: companies.domain, email: contacts.email })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .leftJoin(contacts, and(eq(contacts.leadId, leads.id), eq(contacts.selected, true)))
    .where(and(eq(leads.clientId, clientId), inArray(leads.status, SENT)));

  const matched = new Map<string, string>();
  for (const lead of sent) {
    const match = matched.has(lead.id) ? undefined : suppressionMatch({ email: lead.email, domain: lead.domain }, entries);
    if (match) matched.set(lead.id, `${match.code} (${match.entry.value}), added after the lead was ${lead.status === "pushed" ? "pushed" : "saved in dry run"}`);
  }
  for (const [id, skipReason] of matched) {
    await db.update(leads).set({ status: "suppressed", skipReason }).where(eq(leads.id, id));
  }
  return matched.size;
}
