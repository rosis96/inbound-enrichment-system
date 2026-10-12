import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const KEY = Buffer.alloc(32, 7).toString("base64");
const base = { DATABASE_URL: "mysql://u:p@localhost:3306/enrich", ENCRYPTION_KEY: KEY };

describe("parseEnv", () => {
  it("applies safe defaults", () => {
    const env = parseEnv(base);
    expect(env.GLOBAL_DRY_RUN).toBe(true);
    expect(env.ALLOW_CATCH_ALL).toBe(false);
    expect(env.EMAIL_VERIFIER_PROVIDER).toBe("mock");
    expect(env.CRAWLER_FALLBACK_PROVIDER).toBe("firecrawl");
    expect(env.ADMIN_EMAILS).toEqual([]);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("parses booleans, lists and numbers", () => {
    const env = parseEnv({
      ...base,
      GLOBAL_DRY_RUN: "false",
      ADMIN_EMAILS: " A@x.com, b@y.com ,",
      LLM_PRICE_INPUT_PER_1M: "0.4",
      OPENAI_API_KEY: "",
    });
    expect(env.GLOBAL_DRY_RUN).toBe(false);
    expect(env.ADMIN_EMAILS).toEqual(["a@x.com", "b@y.com"]);
    expect(env.LLM_PRICE_INPUT_PER_1M).toBe(0.4);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("lists every problem in one error", () => {
    try {
      parseEnv({ ENCRYPTION_KEY: "short", GLOBAL_DRY_RUN: "yes" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as EnvError).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("ENCRYPTION_KEY");
      expect(message).toContain("GLOBAL_DRY_RUN");
    }
  });

  it("rejects non-mysql database urls", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: "postgres://localhost/x" })).toThrow(EnvError);
  });
});
