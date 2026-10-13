export const INSTANTLY_API = "https://api.instantly.ai/api/v2";
export const INSTANTLY_LEADS_URL = `${INSTANTLY_API}/leads`;
export const INSTANTLY_CAMPAIGNS_URL = `${INSTANTLY_API}/campaigns`;

export type InstantlyOutcome =
  /** 2xx: lead or campaign created/updated (a lead may be skipped by `skip_if_in_workspace`). */
  | { kind: "ok"; status: number; body: unknown; leadId: string | null }
  /** 401 / 402 / other 4xx: retrying will not help until someone fixes config or billing. */
  | { kind: "config_error"; status: number; body: unknown; code: string }
  /** 429 / 5xx / network: worth retrying. */
  | { kind: "transient"; status: number | null; body: unknown; code: string; retryAfterSeconds: number | null };

export interface InstantlyResponse {
  outcome: InstantlyOutcome;
  durationMs: number;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text.slice(0, 2000);
  }
}

function retryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.round((date - Date.now()) / 1000));
}

type RequestOptions = { fetch?: typeof fetch; timeoutMs?: number };

/** POST /api/v2/leads. Never throws; classifies the result instead. */
export function createInstantlyLead(apiKey: string, body: unknown, options: RequestOptions = {}): Promise<InstantlyResponse> {
  return instantlyRequest("POST", INSTANTLY_LEADS_URL, apiKey, body, options);
}

/** POST /api/v2/campaigns: creates a paused campaign. `leadId` in the outcome is the new campaign id. */
export function createInstantlyCampaign(apiKey: string, body: unknown, options: RequestOptions = {}): Promise<InstantlyResponse> {
  return instantlyRequest("POST", INSTANTLY_CAMPAIGNS_URL, apiKey, body, options);
}

/** PATCH /api/v2/campaigns/:id, e.g. to replace the sequence and schedule. */
export function updateInstantlyCampaign(apiKey: string, campaignId: string, body: unknown, options: RequestOptions = {}): Promise<InstantlyResponse> {
  return instantlyRequest("PATCH", `${INSTANTLY_CAMPAIGNS_URL}/${encodeURIComponent(campaignId)}`, apiKey, body, options);
}

async function instantlyRequest(
  method: "POST" | "PATCH",
  url: string,
  apiKey: string,
  body: unknown,
  options: RequestOptions,
): Promise<InstantlyResponse> {
  const started = Date.now();
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      outcome: { kind: "transient", status: null, body: message, code: "network_error", retryAfterSeconds: null },
      durationMs: Date.now() - started,
    };
  }

  const responseBody = await readBody(response);
  const durationMs = Date.now() - started;
  const { status } = response;

  if (response.ok) {
    // ASSUMPTION: the created lead or campaign is returned as an object with an `id`.
    const id =
      typeof responseBody === "object" && responseBody !== null && "id" in responseBody && typeof responseBody.id === "string"
        ? responseBody.id
        : null;
    return { outcome: { kind: "ok", status, body: responseBody, leadId: id }, durationMs };
  }
  if (status === 401) return { outcome: { kind: "config_error", status, body: responseBody, code: "instantly_unauthorized" }, durationMs };
  if (status === 402) {
    return { outcome: { kind: "config_error", status, body: responseBody, code: "instantly_payment_required" }, durationMs };
  }
  if (status === 429) {
    return {
      outcome: { kind: "transient", status, body: responseBody, code: "instantly_rate_limited", retryAfterSeconds: retryAfter(response) },
      durationMs,
    };
  }
  if (status >= 500) {
    return {
      outcome: { kind: "transient", status, body: responseBody, code: `instantly_${status}`, retryAfterSeconds: retryAfter(response) },
      durationMs,
    };
  }
  return { outcome: { kind: "config_error", status, body: responseBody, code: `instantly_${status}` }, durationMs };
}
