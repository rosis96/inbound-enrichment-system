export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export type LlmOutcome =
  /** 2xx with a JSON object in the message content. */
  | { kind: "ok"; status: number; json: unknown; model: string; usage: LlmUsage }
  /** 401 / 403 / other 4xx, or a reply that is not JSON: retrying will not help. */
  | { kind: "config_error"; status: number | null; body: unknown; code: string }
  /** 429 / 5xx / network: worth retrying. */
  | { kind: "transient"; status: number | null; body: unknown; code: string };

export interface LlmResponse {
  outcome: LlmOutcome;
  durationMs: number;
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** One user message in JSON mode (the prompt must mention JSON). Never throws; classifies the result instead. */
export async function completeJson(
  apiKey: string,
  model: string,
  prompt: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<LlmResponse> {
  const started = Date.now();
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: { kind: "transient", status: null, body: message, code: "network_error" }, durationMs: Date.now() - started };
  }

  const text = await response.text();
  const durationMs = Date.now() - started;
  const { status } = response;
  let body: unknown = text.slice(0, 2000);
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep the truncated text
  }

  if (status === 429 || status >= 500) return { outcome: { kind: "transient", status, body, code: `openai_${status}` }, durationMs };
  if (!response.ok) {
    const code = status === 401 ? "openai_unauthorized" : `openai_${status}`;
    return { outcome: { kind: "config_error", status, body, code }, durationMs };
  }

  const completion = body as ChatCompletion;
  const content = completion.choices?.[0]?.message?.content;
  let json: unknown;
  try {
    json = content ? JSON.parse(content) : undefined;
  } catch {
    json = undefined;
  }
  if (json === undefined) {
    return { outcome: { kind: "config_error", status, body, code: "openai_invalid_json" }, durationMs };
  }
  return {
    outcome: {
      kind: "ok",
      status,
      json,
      model: completion.model ?? model,
      usage: { inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 },
    },
    durationMs,
  };
}
