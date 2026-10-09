import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const booleanFlag = (fallback: boolean) =>
  z
    .enum(["true", "false", ""])
    .optional()
    .transform((value) => (value === undefined || value === "" ? fallback : value === "true"));

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim()));

const optionalNumber = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value.trim() === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      ctx.addIssue({ code: "custom", message: "must be a non-negative number" });
      return z.NEVER;
    }
    return parsed;
  });

const providerName = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? fallback : value.trim().toLowerCase()));

export const encryptionKeySchema = z.string().refine((value) => {
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}, "must be 32 bytes encoded as base64 (generate with: openssl rand -base64 32)");

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_URL: z.url().default("http://localhost:3000"),
  ADMIN_EMAILS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  BETTER_AUTH_SECRET: optionalString,
  ENCRYPTION_KEY: encryptionKeySchema,
  GLOBAL_DRY_RUN: booleanFlag(true),
  ALLOW_CATCH_ALL: booleanFlag(false),
  UNSUB_SUPPRESS_DOMAIN: booleanFlag(false),
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  LLM_PRICE_INPUT_PER_1M: optionalNumber,
  LLM_PRICE_OUTPUT_PER_1M: optionalNumber,
  FIRECRAWL_API_KEY: optionalString,
  CRAWLER_FALLBACK_PROVIDER: providerName("firecrawl"),
  EMAIL_VERIFIER_PROVIDER: providerName("mock"),
  EMAIL_VERIFIER_API_KEY: optionalString,
  EMAIL_FINDER_PROVIDER: providerName("mock"),
  EMAIL_FINDER_API_KEY: optionalString,
  PEOPLE_SEARCH_PROVIDER: providerName("mock"),
  PEOPLE_SEARCH_API_KEY: optionalString,
  SENTRY_DSN: optionalString,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.output<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated process env, parsed once. Throws EnvError listing every problem. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/**
 * Loads the monorepo root `.env` (the nearest `.env` walking up from `startDir`) into
 * process.env without overriding variables that are already set.
 */
export function loadRootEnvFile(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
