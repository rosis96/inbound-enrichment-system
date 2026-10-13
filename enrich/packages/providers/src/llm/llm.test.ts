import { describe, expect, it } from "vitest";
import { checkOpenAiKey, completeJson } from "./index";

const respond = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("completeJson", () => {
  it("returns the parsed JSON content and token usage", async () => {
    let sent: Record<string, unknown> | undefined;
    const fetchSpy = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          model: "m-1",
          choices: [{ message: { content: '{"firstLine":"Hi","subjectLine":"S"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const { outcome } = await completeJson("k", "m", "Return JSON", { fetch: fetchSpy });
    expect(outcome).toEqual({
      kind: "ok",
      status: 200,
      json: { firstLine: "Hi", subjectLine: "S" },
      model: "m-1",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(sent).toMatchObject({ model: "m", response_format: { type: "json_object" } });
  });

  it("classifies errors", async () => {
    expect((await completeJson("k", "m", "p", { fetch: respond(401, {}) })).outcome).toMatchObject({
      kind: "config_error",
      code: "openai_unauthorized",
    });
    expect((await completeJson("k", "m", "p", { fetch: respond(429, {}) })).outcome).toMatchObject({ kind: "transient" });
    expect((await completeJson("k", "m", "p", { fetch: respond(200, { choices: [{ message: { content: "nope" } }] }) })).outcome).toMatchObject({
      kind: "config_error",
      code: "openai_invalid_json",
    });
  });
});

describe("checkOpenAiKey", () => {
  const routes = (map: Record<string, number>) =>
    (async (url: string) => new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), { status: map[url] ?? 500 })) as unknown as typeof fetch;

  it("accepts a working key and model", async () => {
    const result = await checkOpenAiKey("k", "gpt-4o-mini", { fetch: routes({ "https://api.openai.com/v1/models/gpt-4o-mini": 200 }) });
    expect(result).toEqual({ ok: true, modelFound: true });
  });

  it("reports an unknown model separately from a bad key", async () => {
    const unknownModel = routes({ "https://api.openai.com/v1/models/nope": 404, "https://api.openai.com/v1/models": 200 });
    expect(await checkOpenAiKey("k", "nope", { fetch: unknownModel })).toEqual({ ok: true, modelFound: false });
    const badKey = routes({ "https://api.openai.com/v1/models": 401 });
    expect(await checkOpenAiKey("bad", undefined, { fetch: badKey })).toEqual({ ok: false, status: 401, message: "Incorrect API key provided" });
  });
});
