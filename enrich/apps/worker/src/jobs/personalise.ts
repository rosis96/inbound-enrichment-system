import { buildFirstLinePrompt, checkFirstLine } from "@enrich/core";
import { and, contacts, desc, eq, isNotNull, leads, prompts } from "@enrich/db";
import { completeJson } from "@enrich/providers";
import { FirstLineOutput, LeadJobData, parseClientSettings, QUEUE_RETRY } from "@enrich/shared";
import type { JobContext } from "../context";
import { enqueue, loadLead, recordStep } from "../pipeline";

export const schema = LeadJobData;

/** Writes the AI first line + subject for the selected contact, then hands over to push. */
export async function handlePersonalise(data: LeadJobData, ctx: JobContext): Promise<void> {
  const row = await loadLead(ctx.db, data.leadId);
  if (!row) {
    ctx.logger.warn("lead not found, dropping");
    return;
  }
  const { lead, client, company } = row;
  const settings = parseClientSettings(client.settings);
  const { copy } = settings;

  const [contact] = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.leadId, lead.id), eq(contacts.selected, true), isNotNull(contacts.email)))
    .limit(1);
  // Push records `no_contact` itself.
  if (!contact) return enqueue(ctx, "push", data);

  /** Ends the step without a line: push anyway, or fail the lead when the client requires one. */
  const withoutLine = async (status: "skipped" | "failed", reason: string, extra: { input?: unknown; output?: unknown } = {}) => {
    await recordStep(ctx, { leadId: lead.id, contactId: contact.id, step: "personalise", provider: "openai", status, error: reason, ...extra });
    if (copy.requireFirstLine && copy.aiFirstLine) {
      await ctx.db.update(leads).set({ status: "failed", skipReason: `no first line: ${reason}` }).where(eq(leads.id, lead.id));
      ctx.logger.warn({ reason }, "first line required but missing, lead failed");
      return;
    }
    await enqueue(ctx, "push", data);
  };

  if (!copy.aiFirstLine) return withoutLine("skipped", "disabled_for_client");
  if (!ctx.env.OPENAI_API_KEY) return withoutLine("skipped", "no_openai_api_key");

  const [prompt] = await ctx.db
    .select()
    .from(prompts)
    .where(and(eq(prompts.key, "first_line"), eq(prompts.active, true)))
    .orderBy(desc(prompts.version))
    .limit(1);
  if (!prompt) return withoutLine("skipped", "no_active_first_line_prompt");
  const model = prompt.model ?? ctx.env.OPENAI_MODEL;
  if (!model) return withoutLine("skipped", "no_openai_model");

  const text = buildFirstLinePrompt(prompt.template, {
    copy,
    contact,
    company,
    intentTopic: lead.intentTopic,
  });
  const input = { model, promptVersion: prompt.version, prompt: text };
  const { outcome, durationMs } = await completeJson(ctx.env.OPENAI_API_KEY, model, text);

  if (outcome.kind === "transient") {
    const finalAttempt = ctx.attempt > QUEUE_RETRY.retryLimit;
    if (finalAttempt) return withoutLine("failed", outcome.code, { input, output: { status: outcome.status, body: outcome.body } });
    await recordStep(ctx, {
      leadId: lead.id,
      contactId: contact.id,
      step: "personalise",
      provider: "openai",
      status: "failed",
      input,
      output: { status: outcome.status, body: outcome.body, willRetry: true },
      error: outcome.code,
      durationMs,
    });
    throw new Error(`${outcome.code} (attempt ${ctx.attempt})`);
  }
  if (outcome.kind === "config_error") {
    ctx.logger.error({ code: outcome.code, status: outcome.status }, "OpenAI rejected the request");
    return withoutLine("failed", outcome.code, { input, output: { status: outcome.status, body: outcome.body } });
  }

  const { inputTokens, outputTokens } = outcome.usage;
  const costUsd =
    ((ctx.env.LLM_PRICE_INPUT_PER_1M ?? 0) * inputTokens + (ctx.env.LLM_PRICE_OUTPUT_PER_1M ?? 0) * outputTokens) / 1_000_000;
  const parsed = FirstLineOutput.safeParse(outcome.json);
  const problems = parsed.success ? checkFirstLine(parsed.data, copy.bannedPhrases) : ["reply does not match {firstLine, subjectLine}"];
  if (!parsed.success || problems.length > 0) {
    return withoutLine("failed", `guardrails: ${problems.join("; ")}`, { input, output: { json: outcome.json, problems } });
  }

  const firstLine = parsed.data.firstLine.trim();
  const subjectLine = parsed.data.subjectLine.trim();
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(contacts)
      .set({ firstLine, subjectLine, personalisationMeta: { promptVersion: prompt.version, model: outcome.model } })
      .where(eq(contacts.id, contact.id));
    await tx.update(leads).set({ status: "personalised", skipReason: null }).where(eq(leads.id, lead.id));
  });
  await recordStep(ctx, {
    leadId: lead.id,
    contactId: contact.id,
    step: "personalise",
    provider: "openai",
    status: "ok",
    input,
    output: { firstLine, subjectLine, model: outcome.model, usage: outcome.usage },
    durationMs,
    costUsd,
  });
  await enqueue(ctx, "push", data);
}
