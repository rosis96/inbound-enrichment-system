import { IntegrationSettings } from "@enrich/shared";
import { decryptSecret } from "@enrich/shared/crypto";
import type { Env } from "@enrich/shared/env";
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { appSettings } from "./schema";

const INTEGRATIONS = "integrations";

export async function getIntegrationSettings(db: Database): Promise<IntegrationSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, INTEGRATIONS));
  const parsed = IntegrationSettings.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : {};
}

export async function saveIntegrationSettings(db: Database, value: IntegrationSettings): Promise<void> {
  const clean = IntegrationSettings.parse(value);
  await db
    .insert(appSettings)
    .values({ key: INTEGRATIONS, value: clean })
    .onDuplicateKeyUpdate({ set: { value: clean, updatedAt: new Date() } });
}

export type ConfigSource = "app" | "env" | null;

/** OpenAI / crawler settings actually used: the Integrations page wins, .env is the fallback. */
export interface AiConfig {
  openaiApiKey?: string;
  openaiModel?: string;
  priceInputPer1M: number;
  priceOutputPer1M: number;
  firecrawlApiKey?: string;
  sources: { openaiApiKey: ConfigSource; openaiModel: ConfigSource; firecrawlApiKey: ConfigSource };
}

function decrypt(encrypted: string | undefined, key: string): string | undefined {
  if (!encrypted) return undefined;
  try {
    return decryptSecret(encrypted, key);
  } catch {
    // Stored with a different ENCRYPTION_KEY; treat as unset so .env can still apply.
    return undefined;
  }
}

export async function resolveAiConfig(db: Database, env: Env): Promise<AiConfig> {
  const saved = await getIntegrationSettings(db);
  const appKey = decrypt(saved.openaiApiKeyEnc, env.ENCRYPTION_KEY);
  const appFirecrawl = decrypt(saved.firecrawlApiKeyEnc, env.ENCRYPTION_KEY);
  const envFirecrawl = env.CRAWLER_FALLBACK_PROVIDER === "firecrawl" ? env.FIRECRAWL_API_KEY : undefined;
  const pick = <T>(app: T | undefined, fromEnv: T | undefined): [T | undefined, ConfigSource] =>
    app !== undefined ? [app, "app"] : fromEnv !== undefined ? [fromEnv, "env"] : [undefined, null];

  const [openaiApiKey, keySource] = pick(appKey, env.OPENAI_API_KEY);
  const [openaiModel, modelSource] = pick(saved.openaiModel, env.OPENAI_MODEL);
  const [firecrawlApiKey, firecrawlSource] = pick(appFirecrawl, envFirecrawl);
  return {
    openaiApiKey,
    openaiModel,
    priceInputPer1M: saved.llmPriceInputPer1M ?? env.LLM_PRICE_INPUT_PER_1M ?? 0,
    priceOutputPer1M: saved.llmPriceOutputPer1M ?? env.LLM_PRICE_OUTPUT_PER_1M ?? 0,
    firecrawlApiKey,
    sources: { openaiApiKey: keySource, openaiModel: modelSource, firecrawlApiKey: firecrawlSource },
  };
}
