import { describe, expect, it } from "vitest";
import {
  ACTIVECAMPAIGN_PAGE,
  activeCampaignBaseUrl,
  activeCampaignDealContacts,
  ActiveCampaignError,
  activeCampaignTaggedContacts,
  listActiveCampaignPipelines,
} from "./index";

const creds = { apiUrl: "https://acme.api-us1.com/", apiKey: "key123" };

/** Routes by path; records every URL called. */
function fakeFetch(routes: Record<string, (url: URL) => unknown>, calls: URL[] = []) {
  return (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push(url);
    expect((init.headers as Record<string, string>)["api-token"]).toBe("key123");
    const route = routes[url.pathname.replace("/api/3/", "")];
    if (!route) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(route(url)), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("activeCampaignBaseUrl", () => {
  it("adds /api/3 once", () => {
    expect(activeCampaignBaseUrl("https://acme.api-us1.com")).toBe("https://acme.api-us1.com/api/3");
    expect(activeCampaignBaseUrl("https://acme.api-us1.com/api/3/")).toBe("https://acme.api-us1.com/api/3");
  });
});

describe("activeCampaignDealContacts", () => {
  it("pages through all deals and keeps the contacts of deals in the chosen stages", async () => {
    const calls: URL[] = [];
    const full = Array.from({ length: ACTIVECAMPAIGN_PAGE }, (_, i) => ({ id: `${i}`, title: `Deal ${i}`, contact: "", stage: "9" }));
    const fetch = fakeFetch(
      {
        deals: (url) =>
          url.searchParams.get("offset") === "0"
            ? { deals: [...full.slice(2), { id: "a", title: "Acme rebrand", contact: "1", stage: "3" }, { id: "b", title: "Lost", contact: "2", stage: "7" }], contacts: [{ id: "1", email: "Jo@Acme.com" }, { id: "2", email: "x@lost.com" }] }
            : { deals: [{ id: "c", title: "Beta", contact: "3", stage: "4" }], contacts: [{ id: "3", email: "amy@beta.io" }] },
      },
      calls,
    );
    const contacts = await activeCampaignDealContacts(creds, ["3", "4"], { fetch });
    expect(contacts).toEqual([
      { email: "Jo@Acme.com", note: 'ActiveCampaign deal "Acme rebrand"' },
      { email: "amy@beta.io", note: 'ActiveCampaign deal "Beta"' },
    ]);
    expect(calls.map((u) => u.searchParams.get("offset"))).toEqual(["0", "100"]);
    expect(calls[0]?.searchParams.get("include")).toBe("contact");
  });

  it("makes no call without stages", async () => {
    const calls: URL[] = [];
    expect(await activeCampaignDealContacts(creds, [], { fetch: fakeFetch({}, calls) })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("activeCampaignTaggedContacts", () => {
  it("matches tag names exactly, ignoring case, and reports unknown ones", async () => {
    const fetch = fakeFetch({
      tags: (url) =>
        url.searchParams.get("search") === "meeting booked"
          ? { tags: [{ id: "5", tag: "Meeting Booked" }, { id: "6", tag: "Meeting Booked - old" }] }
          : { tags: [] },
      contacts: (url) => ({ contacts: url.searchParams.get("tagid") === "5" ? [{ id: "1", email: "jo@acme.com" }] : [{ id: "2", email: "wrong@x.com" }] }),
    });
    const result = await activeCampaignTaggedContacts(creds, ["meeting booked", "Nope"], { fetch });
    expect(result.contacts).toEqual([{ email: "jo@acme.com", note: 'ActiveCampaign tag "Meeting Booked"' }]);
    expect(result.missingTags).toEqual(["Nope"]);
  });
});

describe("listActiveCampaignPipelines", () => {
  it("groups stages under their pipeline in board order", async () => {
    const fetch = fakeFetch({
      dealGroups: () => ({ dealGroups: [{ id: "1", title: "Sales" }] }),
      dealStages: () => ({
        dealStages: [
          { id: "2", title: "Won", group: "1", order: "2" },
          { id: "1", title: "Lead", group: "1", order: "1" },
        ],
      }),
    });
    expect(await listActiveCampaignPipelines(creds, { fetch })).toEqual([
      { id: "1", title: "Sales", stages: [{ id: "1", title: "Lead" }, { id: "2", title: "Won" }] },
    ]);
  });
});

describe("errors", () => {
  it("names the likely cause of a 401", async () => {
    const respond = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(listActiveCampaignPipelines(creds, { fetch: respond })).rejects.toThrow(/HTTP 401.*API key/);
  });

  it("retries a 429", async () => {
    let n = 0;
    const respond = (async () => (n++ === 0 ? new Response("{}", { status: 429 }) : new Response('{"dealGroups":[],"dealStages":[]}'))) as unknown as typeof fetch;
    expect(await listActiveCampaignPipelines(creds, { fetch: respond, sleep: async () => {} })).toEqual([]);
  });

  it("wraps network errors", async () => {
    const respond = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(activeCampaignDealContacts(creds, ["1"], { fetch: respond })).rejects.toBeInstanceOf(ActiveCampaignError);
  });
});
