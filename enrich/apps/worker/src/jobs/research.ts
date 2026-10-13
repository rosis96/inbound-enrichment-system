import { renderTemplate } from "@enrich/core";
import { and, companies, desc, eq, prompts, resolveAiConfig } from "@enrich/db";
import { completeJson, crawlCompanySite } from "@enrich/providers";
import { CompanySummary, LeadJobData, QUEUE_RETRY } from "@enrich/shared";
import type { JobContext } from "../context";
import { enqueue, loadLead, loadTestFlags, recordStep } from "../pipeline";

export const schema = LeadJobData;

/** Crawl and summary are shared across clients and reused for this long. */
const CACHE_DAYS = 30;

/** Crawls the company's website and summarises it for the writer (cached per company), then hands over to personalise. */
export async function handleResearch(data: LeadJobData, ctx: JobContext): Promise<void> {
  const row = await loadLead(ctx.db, data.leadId);
  if (!row) {
    ctx.logger.warn("lead not found, dropping");
    return;
  }
  const { lead, company } = row;
  const step = (record: Omit<Parameters<typeof recordStep>[1], "leadId" | "step">) =>
    recordStep(ctx, { leadId: lead.id, step: "research", ...record });
  const ai = await resolveAiConfig(ctx.db, ctx.env);
  const refresh = Boolean((await loadTestFlags(ctx.db, lead.rawEventId))?.freshResearch);
  const fresh = (at: Date | null) => at !== null && Date.now() - at.getTime() < CACHE_DAYS * 86_400_000;

  // 1. Crawl, unless a recent crawl exists.
  let crawlText = company.crawlText;
  if (!crawlText || !fresh(company.crawledAt) || refresh || data.force) {
    const started = Date.now();
    const outcome = await crawlCompanySite(company.domain, {
      firecrawlApiKey: ai.firecrawlApiKey,
    });
    if (outcome.kind === "failed") {
      await step({ provider: "crawler", status: "failed", input: { domain: company.domain }, error: `${outcome.code}: ${outcome.detail}`, durationMs: Date.now() - started });
      // Without website text the writer still has name, industry and title.
      return enqueue(ctx, "personalise", data);
    }
    crawlText = outcome.text;
    await ctx.db
      .update(companies)
      .set({ crawlText, crawlSource: outcome.source, crawledAt: new Date(), summary: null, summarisedAt: null })
      .where(eq(companies.id, company.id));
    await step({
      provider: outcome.source,
      status: "ok",
      input: { domain: company.domain },
      output: { pages: outcome.pages.map((p) => ({ url: p.url, title: p.title, chars: p.text.length })), chars: crawlText.length },
      durationMs: Date.now() - started,
    });
  } else if (company.summary && fresh(company.summarisedAt)) {
    await step({ provider: "cache", status: "skipped", output: { note: "recent crawl and summary reused", crawledAt: company.crawledAt } });
    return enqueue(ctx, "personalise", data);
  }

  // 2. Summarise with the active company_summary prompt.
  const apiKey = ai.openaiApiKey;
  const model = ai.openaiModel;
  if (!apiKey || !model) {
    await step({ provider: "openai", status: "skipped", error: apiKey ? "no_openai_model" : "no_openai_api_key" });
    return enqueue(ctx, "personalise", data);
  }
  const [prompt] = await ctx.db
    .select()
    .from(prompts)
    .where(and(eq(prompts.key, "company_summary"), eq(prompts.active, true)))
    .orderBy(desc(prompts.version))
    .limit(1);
  if (!prompt) {
    await step({ provider: "openai", status: "skipped", error: "no_active_company_summary_prompt" });
    return enqueue(ctx, "personalise", data);
  }

  const text = renderTemplate(prompt.template, { domain: company.domain, companyName: company.name ?? company.domain, crawlText });
  const input = { model: prompt.model ?? model, promptVersion: prompt.version, chars: crawlText.length };
  const { outcome, durationMs } = await completeJson(apiKey, prompt.model ?? model, text);
  if (outcome.kind === "transient" && ctx.attempt <= QUEUE_RETRY.retryLimit) {
    await step({ provider: "openai", status: "failed", input, output: { status: outcome.status, willRetry: true }, error: outcome.code, durationMs });
    throw new Error(`${outcome.code} (attempt ${ctx.attempt})`);
  }
  if (outcome.kind !== "ok") {
    await step({ provider: "openai", status: "failed", input, output: { status: outcome.status, body: outcome.body }, error: outcome.code, durationMs });
    return enqueue(ctx, "personalise", data);
  }

  const { inputTokens, outputTokens } = outcome.usage;
  const costUsd =
    (ai.priceInputPer1M * inputTokens + ai.priceOutputPer1M * outputTokens) / 1_000_000;
  // Models sometimes return more hooks than asked; keep the first three rather than fail.
  const json = outcome.json as { personalisationHooks?: unknown };
  if (Array.isArray(json?.personalisationHooks)) json.personalisationHooks = json.personalisationHooks.slice(0, 3);
  const summary = CompanySummary.safeParse(json);
  if (!summary.success) {
    await step({ provider: "openai", status: "failed", input, output: { json: outcome.json }, error: "summary does not match the expected shape", durationMs, costUsd });
    return enqueue(ctx, "personalise", data);
  }

  await ctx.db
    .update(companies)
    .set({ summary: summary.data, summaryModel: outcome.model, summarisedAt: new Date() })
    .where(eq(companies.id, company.id));
  await step({ provider: "openai", status: "ok", input, output: { summary: summary.data, usage: outcome.usage }, durationMs, costUsd });
  await enqueue(ctx, "personalise", data);
}
