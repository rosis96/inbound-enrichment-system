"use server";

import { getDb, getIntegrationSettings, resolveAiConfig, saveIntegrationSettings } from "@enrich/db";
import { checkOpenAiKey } from "@enrich/providers";
import { IntegrationSettings } from "@enrich/shared";
import { encryptSecret } from "@enrich/shared/crypto";
import { getEnv } from "@enrich/shared/env";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

function back(params: Record<string, string>): never {
  redirect(`/integrations?${new URLSearchParams(params)}`);
}

/** Optional non-negative number; blank means "not set". */
function price(value: FormDataEntryValue | null): number | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export async function saveIntegrations(formData: FormData): Promise<void> {
  await requireAdmin();
  const env = getEnv();
  const db = getDb();
  const existing = await getIntegrationSettings(db);
  const text = (name: string) => String(formData.get(name) ?? "").trim();

  const openaiKey = text("openaiApiKey");
  const firecrawlKey = text("firecrawlApiKey");
  const next = {
    // A blank secret field keeps the stored one; the "remove" box clears it.
    openaiApiKeyEnc:
      formData.get("clearOpenaiApiKey") === "on" ? undefined : openaiKey ? encryptSecret(openaiKey, env.ENCRYPTION_KEY) : existing.openaiApiKeyEnc,
    firecrawlApiKeyEnc:
      formData.get("clearFirecrawlApiKey") === "on"
        ? undefined
        : firecrawlKey
          ? encryptSecret(firecrawlKey, env.ENCRYPTION_KEY)
          : existing.firecrawlApiKeyEnc,
    openaiModel: text("openaiModel") || undefined,
    llmPriceInputPer1M: price(formData.get("priceInput")),
    llmPriceOutputPer1M: price(formData.get("priceOutput")),
  };
  const parsed = IntegrationSettings.safeParse(next);
  if (!parsed.success) {
    back({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  await saveIntegrationSettings(db, parsed.data);
  revalidatePath("/integrations");
  back({ notice: "saved" });
}

/** Checks the key and model the worker would use right now. */
export async function testOpenAi(): Promise<void> {
  await requireAdmin();
  const ai = await resolveAiConfig(getDb(), getEnv());
  if (!ai.openaiApiKey) back({ test: "fail", message: "No OpenAI API key is set here or in .env" });
  const result = await checkOpenAiKey(ai.openaiApiKey, ai.openaiModel);
  if (!result.ok) back({ test: "fail", message: `OpenAI said: ${result.message}` });
  if (result.modelFound === false) back({ test: "fail", message: `The key works, but model "${ai.openaiModel}" was not found for it` });
  back({ test: "ok", message: ai.openaiModel ? `Key works and model "${ai.openaiModel}" is available` : "Key works; set a model too" });
}
