import { getDb, getIntegrationSettings, resolveAiConfig, type ConfigSource } from "@enrich/db";
import { getEnv } from "@enrich/shared/env";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { saveIntegrations, testOpenAi } from "./actions";

export const dynamic = "force-dynamic";

const MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-5"];

function SourceBadge({ source }: { source: ConfigSource }) {
  const styles = {
    app: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    env: "bg-sky-50 text-sky-700 ring-sky-600/20",
    none: "bg-slate-100 text-slate-500 ring-slate-500/20",
  };
  const label = source === "app" ? "in use: saved here" : source === "env" ? "in use: from .env" : "not set";
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${styles[source ?? "none"]}`}>{label}</span>
  );
}

function Field({ label, badge, hint, children }: { label: string; badge?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-700">{label}</span>
        {badge}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </label>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; test?: string; message?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const db = getDb();
  const env = getEnv();
  const [saved, ai] = await Promise.all([getIntegrationSettings(db), resolveAiConfig(db, env)]);

  return (
    <>
      <PageHeader title="Integrations" description="Keys and models shared by all clients. Anything left blank here falls back to .env." />

      <div className="mb-6 space-y-3 empty:hidden">
        {params.notice === "saved" && <Alert tone="success">Saved. The worker uses the new values from the next lead.</Alert>}
        {params.error && <Alert tone="error">Not saved: {params.error}</Alert>}
        {params.test === "ok" && <Alert tone="success">{params.message}</Alert>}
        {params.test === "fail" && <Alert tone="error">{params.message}</Alert>}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form action={saveIntegrations} className="min-w-0 space-y-6">
          <Card
            title="OpenAI"
            description="Used to summarise each company's website and write the AI variables. The key is stored encrypted."
          >
            <div className="space-y-5">
              <Field
                label="API key"
                badge={<SourceBadge source={ai.sources.openaiApiKey} />}
                hint={saved.openaiApiKeyEnc ? "A key is saved; leave blank to keep it." : "Starts with sk-…"}
              >
                <input
                  name="openaiApiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={saved.openaiApiKeyEnc ? "••••••••••••••••" : "sk-…"}
                  className="input font-mono"
                />
              </Field>
              {saved.openaiApiKeyEnc && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="clearOpenaiApiKey" className="rounded border-slate-300" /> Remove the saved key
                  {env.OPENAI_API_KEY ? " (falls back to .env)" : ""}
                </label>
              )}
              <Field
                label="Model"
                badge={<SourceBadge source={ai.sources.openaiModel} />}
                hint={`Currently used: ${ai.openaiModel ?? "none"}. gpt-4o-mini is cheap and good enough for most copy.`}
              >
                <input
                  name="openaiModel"
                  list="openai-models"
                  defaultValue={saved.openaiModel ?? ""}
                  placeholder={env.OPENAI_MODEL ?? "gpt-4o-mini"}
                  className="input font-mono"
                />
                <datalist id="openai-models">
                  {MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Input price" hint="USD per 1M tokens, for the AI spend figure">
                  <input
                    name="priceInput"
                    type="number"
                    step="0.001"
                    min={0}
                    defaultValue={saved.llmPriceInputPer1M}
                    placeholder={String(env.LLM_PRICE_INPUT_PER_1M ?? "0.15")}
                    className="input"
                  />
                </Field>
                <Field label="Output price" hint="USD per 1M tokens">
                  <input
                    name="priceOutput"
                    type="number"
                    step="0.001"
                    min={0}
                    defaultValue={saved.llmPriceOutputPer1M}
                    placeholder={String(env.LLM_PRICE_OUTPUT_PER_1M ?? "0.60")}
                    className="input"
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card
            title="Firecrawl"
            description="Optional. Reads websites that block simple requests or only render with JavaScript."
          >
            <div className="space-y-4">
              <Field
                label="API key"
                badge={<SourceBadge source={ai.sources.firecrawlApiKey} />}
                hint={saved.firecrawlApiKeyEnc ? "A key is saved; leave blank to keep it." : "Starts with fc-…"}
              >
                <input
                  name="firecrawlApiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={saved.firecrawlApiKeyEnc ? "••••••••••••••••" : "fc-…"}
                  className="input font-mono"
                />
              </Field>
              {saved.firecrawlApiKeyEnc && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="clearFirecrawlApiKey" className="rounded border-slate-300" /> Remove the saved key
                </label>
              )}
            </div>
          </Card>

          <div className="sticky bottom-4 z-10 flex items-center justify-end rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur">
            <button type="submit" className="btn-primary">
              Save integrations
            </button>
          </div>
        </form>

        <div className="space-y-6">
          <Card title="Check OpenAI" description="Confirms the key and model the worker will use, without spending tokens.">
            <form action={testOpenAi}>
              <button type="submit" className="btn-secondary w-full">
                <Icon name="check" className="size-4" /> Test key
              </button>
            </form>
          </Card>
          <Card title="Per client">
            <p className="text-sm text-slate-500">
              The Instantly API key, campaign and sending settings are per client, on each client&apos;s Settings and Sequence pages.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
