import {
  buildPlan,
  generateVariables,
  LlmTransientError,
  passedValues,
  PERSONALISATION_ENGINE_VERSION,
  rejectedVariables,
  type GenerateOutput,
  type PlanResult,
  type WriterContext,
} from "@enrich/core";
import { and, contacts, eq, isNotNull, leads, resolveAiConfig } from "@enrich/db";
import { openAiJsonCaller } from "@enrich/providers";
import { LeadJobData, parseClientSettings, QUEUE_RETRY } from "@enrich/shared";
import type { JobContext } from "../context";
import { enqueue, loadLead, recordStep } from "../pipeline";

export const schema = LeadJobData;

/**
 * Writes the client's AI variables for the selected contact (research plan, then each variable in
 * dependency order with automatic checks and corrections), then hands over to push.
 */
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

  const llm = openAiJsonCaller({ apiKey, model, priceInputPer1M: ai.priceInputPer1M, priceOutputPer1M: ai.priceOutputPer1M });
  const context: WriterContext = {
    copy,
    contact,
    company: { domain: company.domain, name: company.name, industry: company.industry, country: company.country },
    crawlText: company.crawlText,
    intentTopic: lead.intentTopic,
  };
  const input = { model, engineVersion: PERSONALISATION_ENGINE_VERSION, variables: aiVariables.map((v) => v.name) };
  const started = Date.now();

  let planned: PlanResult;
  let generated: GenerateOutput;
  try {
    // One research plan shared by every variable, then the variables in dependency order.
    planned = await buildPlan(context, llm);
    generated = await generateVariables({ context, plan: planned.plan, variables: aiVariables }, llm);
  } catch (error) {
    if (!(error instanceof LlmTransientError)) throw error;
    const output = { detail: error.detail };
    const durationMs = Date.now() - started;
    if (ctx.attempt > QUEUE_RETRY.retryLimit) return finish("failed", error.code, { input, output, durationMs });
    await recordStep(ctx, {
      leadId: lead.id,
      contactId: contact.id,
      step: "personalise",
      provider: "openai",
      status: "failed",
      input,
      output: { ...output, willRetry: true },
      error: error.code,
      durationMs,
    });
    throw new Error(`${error.code} (attempt ${ctx.attempt})`);
  }

  const durationMs = Date.now() - started;
  const costUsd = planned.costUsd + generated.costUsd;
  const usedModel = generated.model ?? planned.model ?? model;
  const values = passedValues(generated.results);
  const rejected = rejectedVariables(generated.results);
  const written = Object.keys(values).length;
  if (written > 0) {
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({ aiVariables: values, personalisationMeta: { promptVersion: PERSONALISATION_ENGINE_VERSION, model: usedModel } })
        .where(eq(contacts.id, contact.id));
      await tx.update(leads).set({ status: "personalised", skipReason: null }).where(eq(leads.id, lead.id));
    });
  }

  const missing = Object.keys(rejected);
  const output = {
    values,
    rejected,
    model: usedModel,
    calls: generated.calls + 1,
    plan: planned.plan,
    planCheck: planned.check,
    planRaw: planned.raw,
    planError: planned.error,
    results: generated.results,
  };
  if (missing.length === 0) return finish("ok", null, { input, output, durationMs, costUsd });
  return finish(written > 0 ? "ok" : "failed", `guardrails rejected ${missing.join(", ")}`, { input, output, durationMs, costUsd });
}
