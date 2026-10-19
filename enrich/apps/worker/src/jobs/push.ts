import { buildInstantlyLead, suppressionMatch } from "@enrich/core";
import { and, contacts, eq, gt, isNotNull, isNull, leads, or, suppression } from "@enrich/db";
import { createInstantlyLead, INSTANTLY_LEADS_URL, updateInstantlyLead } from "@enrich/providers";
import { LeadJobData, parseClientSettings, QUEUE_RETRY, type LeadStatus } from "@enrich/shared";
import { decryptSecret } from "@enrich/shared/crypto";
import type { JobContext } from "../context";
import { loadLead, loadTestFlags, recordStep } from "../pipeline";

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

  // The gates ran minutes ago; a form fill or booking may have blocklisted the lead since.
  const activeSuppression = await ctx.db
    .select({ kind: suppression.kind, value: suppression.value, reason: suppression.reason })
    .from(suppression)
    .where(and(eq(suppression.clientId, client.id), or(isNull(suppression.expiresAt), gt(suppression.expiresAt, new Date()))));
  const suppressed = suppressionMatch({ email: contact.email, domain: company.domain }, activeSuppression);
  if (suppressed) {
    await setLead({ status: "gated_out", skipReason: `${suppressed.code} (blocklisted before push)` });
    await recordStep(ctx, {
      leadId: lead.id,
      contactId: contact.id,
      step: "push",
      provider: "instantly",
      status: "skipped",
      output: { blocklisted: suppressed.entry },
      error: suppressed.code,
    });
    ctx.logger.info({ reason: suppressed.code }, "blocklisted before push, not sent");
    return;
  }

  const settings = parseClientSettings(client.settings);
  // Without a readable website or with an AI variable missing, the personalised email would read badly:
  // send the lead to the generic campaign, if there is one, without any AI variables.
  const missingVariables = settings.copy.aiVariablesEnabled
    ? settings.aiVariables.map((v) => v.name).filter((name) => !contact.aiVariables?.[name])
    : [];
  const genericReason = !company.crawlText?.trim()
    ? "website could not be read"
    : missingVariables.length > 0
      ? `AI variables missing: ${missingVariables.join(", ")}`
      : null;
  const generic = Boolean(genericReason && settings.campaigns.generic);
  const campaignId = generic
    ? settings.campaigns.generic
    : (lead.intentLevel && settings.campaigns[lead.intentLevel]) || settings.campaigns.default || null;
  const body = buildInstantlyLead({
    campaignId,
    contact: { ...contact, email: contact.email, ...(generic ? { aiVariables: null } : {}) },
    company,
    lead,
    customVariables: settings.customVariables,
  });
  // Already in Instantly (pushed before, kept through a reprocess): replace its variables instead of adding it again,
  // which `skip_if_in_workspace` would silently skip. It stays in the campaign it is in.
  const existingId = contact.instantlyLeadId;
  const wouldMoveTo = existingId && lead.campaignId && lead.campaignId !== campaignId ? campaignId : null;
  const update = existingId
    ? {
        ...(body.first_name ? { first_name: body.first_name } : {}),
        ...(body.last_name ? { last_name: body.last_name } : {}),
        ...(body.company_name ? { company_name: body.company_name } : {}),
        website: body.website,
        custom_variables: body.custom_variables,
      }
    : null;
  const request = {
    method: existingId ? "PATCH" : "POST",
    url: existingId ? `${INSTANTLY_LEADS_URL}/${existingId}` : INSTANTLY_LEADS_URL,
    body: update ?? body,
    campaign: generic ? "generic" : "personalised",
    ...(genericReason ? { genericReason } : {}),
    ...(wouldMoveTo ? { note: `would now go to campaign ${wouldMoveTo}; left in ${lead.campaignId}, move it in Instantly if needed` } : {}),
  };

  const test = await loadTestFlags(ctx.db, lead.rawEventId);
  const dryRunSource = ctx.env.GLOBAL_DRY_RUN ? "GLOBAL_DRY_RUN" : client.dryRun ? "client" : test?.dryRun ? "test lead" : null;
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

  // A lead already in Instantly stays pushed when only its update failed.
  const pushedCampaign = existingId ? (lead.campaignId ?? campaignId) : campaignId;
  const failedLead = (code: string) =>
    existingId ? { status: "pushed" as const, skipReason: `variables not updated: ${code}`, campaignId: pushedCampaign } : { status: "failed" as const, skipReason: code, campaignId };

  const fail = async (code: string, output?: unknown) => {
    await setLead(failedLead(code));
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

  const apiKey = decryptSecret(client.instantlyApiKeyEnc, ctx.env.ENCRYPTION_KEY);
  const { outcome, durationMs } = existingId ? await updateInstantlyLead(apiKey, existingId, update) : await createInstantlyLead(apiKey, body);
  const response = { status: outcome.status, body: outcome.body };

  if (outcome.kind === "ok" && existingId) {
    await setLead({ status: "pushed", skipReason: null, campaignId: pushedCampaign });
    await recordStep(ctx, {
      leadId: lead.id,
      contactId: contact.id,
      step: "push",
      provider: "instantly",
      status: "ok",
      input: request,
      output: { updated: true, ...response },
      durationMs,
    });
    ctx.logger.info({ instantlyLeadId: existingId }, "updated the lead's variables in Instantly");
    return;
  }

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
    await setLead(failedLead(outcome.code));
    ctx.logger.error({ code: outcome.code }, "Instantly still failing after retries");
    return;
  }
  ctx.logger.warn({ code: outcome.code, attempt: ctx.attempt }, "Instantly transient error, will retry");
  throw new Error(`${outcome.code} (attempt ${ctx.attempt})`);
}
