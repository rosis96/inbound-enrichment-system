import { buildInstantlyLead } from "@enrich/core";
import { and, contacts, eq, isNotNull, leads } from "@enrich/db";
import { createInstantlyLead, INSTANTLY_LEADS_URL } from "@enrich/providers";
import { LeadJobData, parseClientSettings, QUEUE_RETRY, type LeadStatus } from "@enrich/shared";
import { decryptSecret } from "@enrich/shared/crypto";
import type { JobContext } from "../context";
import { loadLead, recordStep } from "../pipeline";

export const schema = LeadJobData;

const DONE: LeadStatus[] = ["pushed", "dry_run_complete"];

export async function handlePush(data: LeadJobData, ctx: JobContext): Promise<void> {
  const row = await loadLead(ctx.db, data.leadId);
  if (!row) {
    ctx.logger.warn("lead not found, dropping");
    return;
  }
  const { lead, client, company } = row;
  if (DONE.includes(lead.status) && !data.force) {
    ctx.logger.info({ status: lead.status }, "already pushed, skipping");
    return;
  }

  const setLead = (values: Partial<typeof leads.$inferInsert>) =>
    ctx.db.update(leads).set(values).where(eq(leads.id, lead.id));

  const [contact] = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.leadId, lead.id), eq(contacts.selected, true), isNotNull(contacts.email)))
    .limit(1);
  if (!contact?.email) {
    await setLead({ status: "no_contact", skipReason: "no eligible contact with an email" });
    await recordStep(ctx, { leadId: lead.id, step: "push", provider: "instantly", status: "skipped", error: "no_contact" });
    return;
  }

  const settings = parseClientSettings(client.settings);
  const campaignId = (lead.intentLevel && settings.campaigns[lead.intentLevel]) || settings.campaigns.default || null;
  const body = buildInstantlyLead({
    campaignId,
    contact: { email: contact.email, firstName: contact.firstName, lastName: contact.lastName, title: contact.title },
    company,
    lead,
  });
  const request = { method: "POST", url: INSTANTLY_LEADS_URL, body };

  const dryRunSource = ctx.env.GLOBAL_DRY_RUN ? "GLOBAL_DRY_RUN" : client.dryRun ? "client" : null;
  if (dryRunSource) {
    await setLead({ status: "dry_run_complete", skipReason: null, campaignId });
    await recordStep(ctx, {
      leadId: lead.id,
      contactId: contact.id,
      step: "push",
      provider: "instantly",
      status: "skipped",
      input: request,
      output: {
        dryRun: true,
        dryRunSource,
        note: campaignId ? "request not sent" : "request not sent; no campaign configured, a live push would fail",
      },
    });
    ctx.logger.info({ dryRunSource }, "dry run: Instantly request saved, not sent");
    return;
  }

  const fail = async (code: string, output?: unknown) => {
    await setLead({ status: "failed", skipReason: code, campaignId });
    await recordStep(ctx, {
      leadId: lead.id,
      contactId: contact.id,
      step: "push",
      provider: "instantly",
      status: "failed",
      input: request,
      output: output ?? null,
      error: code,
    });
  };

  if (!campaignId) return fail("no_campaign");
  if (!client.instantlyApiKeyEnc) return fail("no_instantly_api_key");

  const { outcome, durationMs } = await createInstantlyLead(decryptSecret(client.instantlyApiKeyEnc, ctx.env.ENCRYPTION_KEY), body);
  const response = { status: outcome.status, body: outcome.body };

  if (outcome.kind === "ok") {
    await ctx.db.transaction(async (tx) => {
      await tx.update(leads).set({ status: "pushed", skipReason: null, campaignId }).where(eq(leads.id, lead.id));
      await tx
        .update(contacts)
        .set({ instantlyLeadId: outcome.leadId, outreachStatus: "queued" })
        .where(eq(contacts.id, contact.id));
    });
    await recordStep(ctx, {
      leadId: lead.id,
      contactId: contact.id,
      step: "push",
      provider: "instantly",
      status: "ok",
      input: request,
      output: response,
      durationMs,
    });
    ctx.logger.info({ instantlyLeadId: outcome.leadId }, "pushed to Instantly");
    return;
  }

  if (outcome.kind === "config_error") {
    ctx.logger.error({ code: outcome.code, status: outcome.status }, "Instantly rejected the request");
    return fail(outcome.code, response);
  }

  // Transient (429, 5xx, network): throw so the queue retries with backoff until attempts run out.
  const finalAttempt = ctx.attempt > QUEUE_RETRY.retryLimit;
  await recordStep(ctx, {
    leadId: lead.id,
    contactId: contact.id,
    step: "push",
    provider: "instantly",
    status: "failed",
    input: request,
    output: { ...response, retryAfterSeconds: outcome.retryAfterSeconds, willRetry: !finalAttempt },
    error: outcome.code,
    durationMs,
  });
  if (finalAttempt) {
    await setLead({ status: "failed", skipReason: outcome.code, campaignId });
    ctx.logger.error({ code: outcome.code }, "Instantly still failing after retries");
    return;
  }
  ctx.logger.warn({ code: outcome.code, attempt: ctx.attempt }, "Instantly transient error, will retry");
  throw new Error(`${outcome.code} (attempt ${ctx.attempt})`);
}
