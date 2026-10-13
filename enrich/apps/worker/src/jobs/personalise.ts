import { buildVariablesPrompt, pickVariables, VARIABLES_PROMPT_VERSION } from "@enrich/core";
import { and, contacts, eq, isNotNull, leads, resolveAiConfig } from "@enrich/db";
import { completeJson } from "@enrich/providers";
import { AiVariablesOutput, LeadJobData, parseClientSettings, QUEUE_RETRY } from "@enrich/shared";
import type { JobContext } from "../context";
import { enqueue, loadLead, recordStep } from "../pipeline";

export const schema = LeadJobData;

/** Writes the client's AI variables for the selected contact, then hands over to push. */
export async function handlePersonalise(data: LeadJobData, ctx: JobContext): Promise<void> {
  const row = await loadLead(ctx.db, data.leadId);
  if (!row) {
    ctx.logger.warn("lead not found, dropping");
    return;
  }
  const { lead, client, company } = row;
  const settings = parseClientSettings(client.settings);
  const { copy, aiVariables } = settings;

  const [contact] = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.leadId, lead.id), eq(contacts.selected, true), isNotNull(contacts.email)))
    .limit(1);
  // Push records `no_contact` itself.
  if (!contact) return enqueue(ctx, "push", data);

  const required = copy.requireAiVariables && copy.aiVariablesEnabled && aiVariables.length > 0;

  /** Ends the step with some or no variables: push anyway, or fail the lead when the client requires all of them. */
  const finish = async (
    status: "ok" | "skipped" | "failed",
    reason: string | null,
    extra: { input?: unknown; output?: unknown; durationMs?: number; costUsd?: number } = {},
  ) => {
    await recordStep(ctx, { leadId: lead.id, contactId: contact.id, step: "personalise", provider: "openai", status, error: reason, ...extra });
    if (reason && required) {
      await ctx.db.update(leads).set({ status: "failed", skipReason: `AI variables missing: ${reason}` }).where(eq(leads.id, lead.id));
      ctx.logger.warn({ reason }, "AI variables required but missing, lead failed");
      return;
    }
    await enqueue(ctx, "push", data);
  };

  if (!copy.aiVariablesEnabled) return finish("skipped", null, { output: { note: "disabled for client" } });
  if (aiVariables.length === 0) return finish("skipped", null, { output: { note: "no AI variables configured" } });
  const ai = await resolveAiConfig(ctx.db, ctx.env);
  const apiKey = ai.openaiApiKey;
  const model = ai.openaiModel;
  if (!apiKey) return finish("skipped", "no_openai_api_key");
  if (!model) return finish("skipped", "no_openai_model");

  const prompt = buildVariablesPrompt({
    copy,
    variables: aiVariables,
    contact,
    company,
    intentTopic: lead.intentTopic,
    pages: lead.pages,
  });
  const input = { model, promptVersion: VARIABLES_PROMPT_VERSION, variables: aiVariables.map((v) => v.name), prompt };
  const { outcome, durationMs } = await completeJson(apiKey, model, prompt);

  if (outcome.kind === "transient") {
    const output = { status: outcome.status, body: outcome.body };
    if (ctx.attempt > QUEUE_RETRY.retryLimit) return finish("failed", outcome.code, { input, output, durationMs });
    await recordStep(ctx, {
      leadId: lead.id,
      contactId: contact.id,
      step: "personalise",
      provider: "openai",
      status: "failed",
      input,
      output: { ...output, willRetry: true },
      error: outcome.code,
      durationMs,
    });
    throw new Error(`${outcome.code} (attempt ${ctx.attempt})`);
  }
  if (outcome.kind === "config_error") {
    ctx.logger.error({ code: outcome.code, status: outcome.status }, "OpenAI rejected the request");
    return finish("failed", outcome.code, { input, output: { status: outcome.status, body: outcome.body }, durationMs });
  }

  const { inputTokens, outputTokens } = outcome.usage;
  const costUsd =
    (ai.priceInputPer1M * inputTokens + ai.priceOutputPer1M * outputTokens) / 1_000_000;
  const parsed = AiVariablesOutput.safeParse(outcome.json);
  if (!parsed.success) {
    return finish("failed", "reply does not match {variables: {...}}", { input, output: { json: outcome.json }, durationMs, costUsd });
  }

  const { values, rejected } = pickVariables(aiVariables, parsed.data, copy.bannedPhrases);
  const written = Object.keys(values).length;
  if (written > 0) {
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({ aiVariables: values, personalisationMeta: { promptVersion: VARIABLES_PROMPT_VERSION, model: outcome.model } })
        .where(eq(contacts.id, contact.id));
      await tx.update(leads).set({ status: "personalised", skipReason: null }).where(eq(leads.id, lead.id));
    });
  }

  const missing = Object.keys(rejected);
  const output = { values, rejected, model: outcome.model, usage: outcome.usage };
  if (missing.length === 0) return finish("ok", null, { input, output, durationMs, costUsd });
  return finish(written > 0 ? "ok" : "failed", `guardrails rejected ${missing.join(", ")}`, { input, output, durationMs, costUsd });
}
