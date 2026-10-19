/** Page size for list endpoints, ActiveCampaign's maximum. */
export const ACTIVECAMPAIGN_PAGE = 100;
/** Stops a runaway pagination (100k records). */
const MAX_PAGES = 1000;

export interface ActiveCampaignCredentials {
  /** The account's API URL, e.g. `https://acme.api-us1.com`; `/api/3` is added. */
  apiUrl: string;
  apiKey: string;
}

export interface ActiveCampaignContact {
  email: string;
  /** Where the contact came from, e.g. `deal "Acme rebrand"` or `tag "Meeting Booked"`. */
  note: string;
}

export interface ActiveCampaignPipeline {
  id: string;
  title: string;
  stages: { id: string; title: string }[];
}

/** 401/403/404 mean the URL or key is wrong; anything else may pass on the next run. */
export class ActiveCampaignError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ActiveCampaignError";
  }
}

type RequestOptions = { fetch?: typeof fetch; timeoutMs?: number; sleep?: (ms: number) => Promise<void> };

/** `https://acme.api-us1.com/api/3/` → `https://acme.api-us1.com/api/3`. */
export function activeCampaignBaseUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, "").replace(/\/api\/3$/, "");
  return `${trimmed}/api/3`;
}

async function acGet(creds: ActiveCampaignCredentials, path: string, params: Record<string, string>, options: RequestOptions): Promise<Record<string, unknown>> {
  const url = `${activeCampaignBaseUrl(creds.apiUrl)}/${path}?${new URLSearchParams(params)}`;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  // The API allows 5 requests a second per account; a 429 is retried after a pause.
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await doFetch(url, {
        headers: { "api-token": creds.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new ActiveCampaignError(`network error: ${error instanceof Error ? error.message : String(error)}`, null);
    }
    if (response.status === 429 && attempt < 3) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403 ? " (check the API key)" : response.status === 404 ? " (check the API URL)" : "";
      throw new ActiveCampaignError(`ActiveCampaign returned HTTP ${response.status} for /${path}${hint}`, response.status);
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!body || typeof body !== "object") throw new ActiveCampaignError(`ActiveCampaign sent a non-JSON response for /${path}`, response.status);
    return body as Record<string, unknown>;
  }
}

const records = (body: Record<string, unknown>, key: string): Record<string, unknown>[] =>
  Array.isArray(body[key]) ? (body[key] as unknown[]).filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object") : [];

const str = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value) : "");

/** Every page of a list endpoint; `onPage` gets each page's body. */
async function eachPage(
  creds: ActiveCampaignCredentials,
  path: string,
  params: Record<string, string>,
  listKey: string,
  onPage: (body: Record<string, unknown>) => void,
  options: RequestOptions,
): Promise<void> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await acGet(creds, path, { ...params, limit: String(ACTIVECAMPAIGN_PAGE), offset: String(page * ACTIVECAMPAIGN_PAGE) }, options);
    onPage(body);
    if (records(body, listKey).length < ACTIVECAMPAIGN_PAGE) return;
  }
}

/** Pipelines (deal groups) with their stages, for picking which stages to blocklist. */
export async function listActiveCampaignPipelines(creds: ActiveCampaignCredentials, options: RequestOptions = {}): Promise<ActiveCampaignPipeline[]> {
  const pipelines: ActiveCampaignPipeline[] = [];
  await eachPage(creds, "dealGroups", {}, "dealGroups", (body) => {
    for (const group of records(body, "dealGroups")) pipelines.push({ id: str(group.id), title: str(group.title), stages: [] });
  }, options);
  const byId = new Map(pipelines.map((p) => [p.id, p]));
  const stages: { id: string; title: string; group: string; order: number }[] = [];
  await eachPage(creds, "dealStages", {}, "dealStages", (body) => {
    for (const stage of records(body, "dealStages")) {
      stages.push({ id: str(stage.id), title: str(stage.title), group: str(stage.group), order: Number(stage.order) || 0 });
    }
  }, options);
  stages.sort((a, b) => a.order - b.order || Number(a.id) - Number(b.id));
  for (const stage of stages) byId.get(stage.group)?.stages.push({ id: stage.id, title: stage.title });
  return pipelines;
}

/**
 * The primary contact of every deal in one of `stageIds`, whatever the deal's status: many accounts
 * track won and lost deals as stages and leave the status open.
 */
export async function activeCampaignDealContacts(
  creds: ActiveCampaignCredentials,
  stageIds: readonly string[],
  options: RequestOptions = {},
): Promise<ActiveCampaignContact[]> {
  if (stageIds.length === 0) return [];
  const wanted = new Set(stageIds);
  const contacts: ActiveCampaignContact[] = [];
  // One pass over all deals with their contacts side-loaded, filtered here: fewer calls than one query per stage.
  await eachPage(creds, "deals", { include: "contact", "orders[cdate]": "ASC" }, "deals", (body) => {
    const emails = new Map(records(body, "contacts").map((c) => [str(c.id), str(c.email)]));
    for (const deal of records(body, "deals")) {
      if (!wanted.has(str(deal.stage))) continue;
      const email = emails.get(str(deal.contact));
      if (email) contacts.push({ email, note: `ActiveCampaign deal "${str(deal.title)}"`.slice(0, 500) });
    }
  }, options);
  return contacts;
}

/** Contacts with any of the tags, matched by name without regard to case. Unknown tag names are returned in `missingTags`. */
export async function activeCampaignTaggedContacts(
  creds: ActiveCampaignCredentials,
  tagNames: readonly string[],
  options: RequestOptions = {},
): Promise<{ contacts: ActiveCampaignContact[]; missingTags: string[] }> {
  const contacts: ActiveCampaignContact[] = [];
  const missingTags: string[] = [];
  for (const name of tagNames) {
    const found = records(await acGet(creds, "tags", { search: name, limit: String(ACTIVECAMPAIGN_PAGE) }, options), "tags").filter(
      (tag) => str(tag.tag).trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (found.length === 0) missingTags.push(name);
    for (const tag of found) {
      await eachPage(creds, "contacts", { tagid: str(tag.id) }, "contacts", (body) => {
        for (const contact of records(body, "contacts")) {
          const email = str(contact.email);
          if (email) contacts.push({ email, note: `ActiveCampaign tag "${str(tag.tag)}"` });
        }
      }, options);
    }
  }
  return { contacts, missingTags };
}
