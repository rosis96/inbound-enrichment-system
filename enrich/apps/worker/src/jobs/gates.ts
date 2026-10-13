import { evaluateGates } from "@enrich/core";
import { and, contacts, desc, eq, gt, gte, inArray, isNull, leads, ne, or, suppression } from "@enrich/db";
import { LeadJobData, parseClientSettings } from "@enrich/shared";
import type { JobContext } from "../context";
import { enqueue, loadLead, loadTestFlags, recordStep } from "../pipeline";

export const schema = LeadJobData;

/** A previous lead for the same company only counts as a duplicate once it reached outreach. */
const DEDUPE_STATUSES = ["pushed", "dry_run_complete"] as const;

export async function handleGates(data: LeadJobData, ctx: JobContext): Promise<void> {
  const started = Date.now();
  const row = await loadLead(ctx.db, data.leadId);
  if (!row) {
    ctx.logger.warn("lead not found, dropping");
    return;
  }
  const { lead, client, company } = row;
  const settings = parseClientSettings(client.settings);
  const now = new Date();

  const leadContacts = await ctx.db
    .select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.leadId, lead.id));

  const activeSuppression = await ctx.db
    .select({ kind: suppression.kind, value: suppression.value, reason: suppression.reason })
    .from(suppression)
    .where(and(eq(suppression.clientId, client.id), or(isNull(suppression.expiresAt), gt(suppression.expiresAt, now))));

  const test = await loadTestFlags(ctx.db, lead.rawEventId);
  const [duplicate] =
    settings.dedupeDays > 0 && !test?.skipDedupe
      ? await ctx.db
          .select({ id: leads.id, status: leads.status, createdAt: leads.createdAt })
          .from(leads)
          .where(
            and(
              eq(leads.clientId, client.id),
              eq(leads.companyId, company.id),
              ne(leads.id, lead.id),
              inArray(leads.status, [...DEDUPE_STATUSES]),
              gte(leads.createdAt, new Date(now.getTime() - settings.dedupeDays * 86_400_000)),
            ),
          )
          .orderBy(desc(leads.createdAt))
          .limit(1)
      : [];

  const result = evaluateGates({
    domain: company.domain,
    contacts: leadContacts,
    suppression: activeSuppression,
    duplicate: duplicate ?? null,
    settings,
  });

  await ctx.db.transaction(async (tx) => {
    await tx.update(contacts).set({ selected: false }).where(eq(contacts.leadId, lead.id));
    if (result.eligibleContactIds.length > 0) {
      await tx.update(contacts).set({ selected: true }).where(inArray(contacts.id, result.eligibleContactIds));
    }
    await tx
      .update(leads)
      .set(result.passed ? { status: "normalised", skipReason: null } : { status: "gated_out", skipReason: result.reason })
      .where(eq(leads.id, lead.id));
  });

  await recordStep(ctx, {
    leadId: lead.id,
    step: "gates",
    provider: "internal",
    status: result.passed ? "ok" : "skipped",
    input: { domain: company.domain, contacts: leadContacts.length, suppressionRows: activeSuppression.length },
    output: result,
    durationMs: Date.now() - started,
  });

  if (result.passed) await enqueue(ctx, "icp", data);
  else ctx.logger.info({ reason: result.reason }, "gated out");
}
