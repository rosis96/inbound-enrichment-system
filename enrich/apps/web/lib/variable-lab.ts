import {
  buildPlan,
  generateVariables,
  LlmTransientError,
  normaliseDomain,
  type LlmJsonCall,
  type WriterContext,
} from "@enrich/core";
import { clients, companies, eq, getDb, resolveAiConfig, variableTests, type VariableTestContact } from "@enrich/db";
import { crawlCompanySite, openAiJsonCaller } from "@enrich/providers";
import { parseClientSettings, withDependencies, withDependents, type PersonalisationPlan, type VariableResult } from "@enrich/shared";
import { getEnv } from "@enrich/shared/env";

/** Same freshness as the worker's research step, so the lab and real leads read the same text. */
const CRAWL_CACHE_DAYS = 30;

export class LabError extends Error {}

async function aiCaller(): Promise<{ llm: LlmJsonCall; model: string }> {
  const ai = await resolveAiConfig(getDb(), getEnv());
  if (!ai.openaiApiKey) throw new LabError("No OpenAI API key: add one on the Integrations page.");
  if (!ai.openaiModel) throw new LabError("No OpenAI model: set one on the Integrations page.");
  const llm = openAiJsonCaller({
    apiKey: ai.openaiApiKey,
    model: ai.openaiModel,
    priceInputPer1M: ai.priceInputPer1M,
    priceOutputPer1M: ai.priceOutputPer1M,
  });
  return { llm, model: ai.openaiModel };
}

/** The shared company row for a domain, created if needed, with website text no older than the cache. */
async function companyWithCrawl(domain: string, refresh: boolean) {
  const db = getDb();
  let [company] = await db.select().from(companies).where(eq(companies.domain, domain));
  if (!company) {
    await db.insert(companies).values({ domain }).onDuplicateKeyUpdate({ set: { domain } });
    [company] = await db.select().from(companies).where(eq(companies.domain, domain));
  }
  if (!company) throw new LabError(`Could not store ${domain}`);

  const fresh = company.crawledAt && Date.now() - company.crawledAt.getTime() < CRAWL_CACHE_DAYS * 86_400_000;
  // Crawls from before page URLs were stored can't link facts to pages, so read them again.
  const hasSources = company.crawlText?.includes("\nSource: ");
  if (company.crawlText && fresh && hasSources && !refresh) return company;

  const { firecrawlApiKey } = await resolveAiConfig(db, getEnv());
  const outcome = await crawlCompanySite(domain, { firecrawlApiKey });
  if (outcome.kind === "failed") {
    // Keep going with older text if there is any; the plan then stays general.
    if (company.crawlText) return company;
    throw new LabError(`Could not read ${domain}: ${outcome.code} (${outcome.detail})`);
  }
  await db
    .update(companies)
    .set({ crawlText: outcome.text, crawlSource: outcome.source, crawledAt: new Date(), summary: null, summarisedAt: null })
    .where(eq(companies.id, company.id));
  return { ...company, crawlText: outcome.text, crawledAt: new Date() };
}

async function loadClient(clientId: string) {
  const [client] = await getDb().select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw new LabError("Pick a client");
  return { client, settings: parseClientSettings(client.settings) };
}

function writerContext(
  settings: ReturnType<typeof parseClientSettings>,
  company: { domain: string; name: string | null; industry: string | null; country: string | null; crawlText: string | null },
  contact: VariableTestContact,
): WriterContext {
  return {
    copy: settings.copy,
    contact,
    company: { domain: company.domain, name: company.name, industry: company.industry, country: company.country },
    crawlText: company.crawlText,
  };
}

const message = (error: unknown) =>
  error instanceof LlmTransientError ? `OpenAI is unavailable right now (${error.code}); try again.` : error instanceof Error ? error.message : String(error);

/** Researches the website, plans and writes every variable; returns the new test's id. */
export async function startTest(input: {
  clientId: string;
  website: string;
  contact: VariableTestContact;
  refresh: boolean;
  /** Test one variable (plus the variables it needs first); empty tests all. */
  variable?: string;
}): Promise<string> {
  const domain = normaliseDomain(input.website);
  if (!domain) throw new LabError("Enter a website such as related.com");
  const { client, settings } = await loadClient(input.clientId);
  if (settings.aiVariables.length === 0) throw new LabError("This client has no AI variables; add some in Settings first.");
  if (input.variable && !settings.aiVariables.some((v) => v.name === input.variable)) {
    throw new LabError(`${client.name} has no AI variable "${input.variable}"`);
  }
  const only = input.variable ? withDependencies([input.variable], settings.aiVariables) : undefined;
  const { llm, model } = await aiCaller();
  const company = await companyWithCrawl(domain, input.refresh);
  const context = writerContext(settings, company, input.contact);

  const id = crypto.randomUUID();
  try {
    const planned = await buildPlan(context, llm);
    const generated = await generateVariables({ context, plan: planned.plan, variables: settings.aiVariables, only }, llm);
    await getDb()
      .insert(variableTests)
      .values({
        id,
        clientId: client.id,
        companyId: company.id,
        contact: input.contact,
        plan: planned.plan,
        planCheck: planned.check,
        planError: planned.error,
        results: generated.results,
        model: generated.model ?? planned.model ?? model,
        costUsd: planned.costUsd + generated.costUsd,
      });
  } catch (error) {
    throw new LabError(message(error));
  }
  return id;
}

async function loadTest(testId: string) {
  const db = getDb();
  const [row] = await db
    .select({ test: variableTests, company: companies })
    .from(variableTests)
    .innerJoin(companies, eq(variableTests.companyId, companies.id))
    .where(eq(variableTests.id, testId));
  if (!row) throw new LabError("Test not found");
  return row;
}

export type RetestMode =
  /** Rewrite the given variables and those depending on them, with the stored plan. */
  | { kind: "variables"; names: string[] }
  /** Rewrite every variable with the stored plan. */
  | { kind: "all" }
  /** New plan from the stored website text, then every variable. */
  | { kind: "replan" }
  /** Read the website again, new plan, every variable. */
  | { kind: "refresh" };

/** Re-runs part of a test with the client's current settings; never recrawls unless asked. */
export async function retest(testId: string, mode: RetestMode): Promise<void> {
  const { test, company: storedCompany } = await loadTest(testId);
  const { settings } = await loadClient(test.clientId);
  const { llm, model } = await aiCaller();
  const company = mode.kind === "refresh" ? await companyWithCrawl(storedCompany.domain, true) : storedCompany;
  const context = writerContext(settings, company, test.contact);

  try {
    let plan: PersonalisationPlan | null = test.plan;
    let planCheck = test.planCheck;
    let planError = test.planError;
    let costUsd = test.costUsd;
    let planModel: string | null = null;
    if (!plan || mode.kind === "replan" || mode.kind === "refresh") {
      const planned = await buildPlan(context, llm);
      ({ plan, check: planCheck, error: planError } = planned);
      costUsd += planned.costUsd;
      planModel = planned.model;
    }

    const known = new Set(settings.aiVariables.map((v) => v.name));
    const only = mode.kind === "variables" ? withDependents(mode.names.filter((n) => known.has(n)), settings.aiVariables) : undefined;
    const previous: Record<string, VariableResult> = mode.kind === "variables" ? test.results : {};
    const generated = await generateVariables({ context, plan, variables: settings.aiVariables, only, previous }, llm);

    await getDb()
      .update(variableTests)
      .set({
        plan,
        planCheck,
        planError,
        results: generated.results,
        model: generated.model ?? planModel ?? test.model ?? model,
        costUsd: costUsd + generated.costUsd,
        error: null,
      })
      .where(eq(variableTests.id, testId));
  } catch (error) {
    throw new LabError(message(error));
  }
}
