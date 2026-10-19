import { describe, expect, it } from "vitest";
import {
  blocklistEntryIds,
  createInstantlyBlocklistEntries,
  createInstantlyCampaign,
  createInstantlyLead,
  deleteInstantlyBlocklistEntry,
  updateInstantlyCampaign,
  updateInstantlyLead,
} from "./index";

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

describe("createInstantlyLead", () => {
  it("sends a bearer-authenticated JSON POST and returns the lead id", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchSpy = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "lead_1", email: "a@b.example" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { outcome } = await createInstantlyLead("key123", { email: "a@b.example" }, { fetch: fetchSpy });
    expect(outcome).toMatchObject({ kind: "ok", status: 200, leadId: "lead_1" });
    expect(seen?.url).toBe("https://api.instantly.ai/api/v2/leads");
    expect(seen?.init.method).toBe("POST");
    expect((seen?.init.headers as Record<string, string>).authorization).toBe("Bearer key123");
    expect(seen?.init.body).toBe('{"email":"a@b.example"}');
  });

  it("treats 401 and 402 as config errors (no retry)", async () => {
    expect((await createInstantlyLead("k", {}, { fetch: respond(401, {}) })).outcome).toMatchObject({
      kind: "config_error",
      code: "instantly_unauthorized",
    });
    expect((await createInstantlyLead("k", {}, { fetch: respond(402, {}) })).outcome).toMatchObject({
      kind: "config_error",
      code: "instantly_payment_required",
    });
    expect((await createInstantlyLead("k", {}, { fetch: respond(400, { message: "bad" }) })).outcome).toMatchObject({
      kind: "config_error",
      code: "instantly_400",
    });
  });

  it("treats 429, 5xx and network errors as transient", async () => {
    expect((await createInstantlyLead("k", {}, { fetch: respond(429, {}, { "retry-after": "30" }) })).outcome).toMatchObject({
      kind: "transient",
      code: "instantly_rate_limited",
      retryAfterSeconds: 30,
    });
    expect((await createInstantlyLead("k", {}, { fetch: respond(503, {}) })).outcome).toMatchObject({
      kind: "transient",
      code: "instantly_503",
    });
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await createInstantlyLead("k", {}, { fetch: failing })).outcome).toMatchObject({
      kind: "transient",
      status: null,
      code: "network_error",
    });
  });
});

describe("Instantly campaigns", () => {
  it("creates with POST and updates with PATCH on the campaign id", async () => {
    const seen: { url: string; method?: string }[] = [];
    const fetchSpy = (async (url: string, init: RequestInit) => {
      seen.push({ url, method: init.method });
      return new Response(JSON.stringify({ id: "camp_1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const created = await createInstantlyCampaign("k", { name: "x" }, { fetch: fetchSpy });
    expect(created.outcome).toMatchObject({ kind: "ok", leadId: "camp_1" });
    await updateInstantlyCampaign("k", "camp_1", { name: "x" }, { fetch: fetchSpy });
    expect(seen).toEqual([
      { url: "https://api.instantly.ai/api/v2/campaigns", method: "POST" },
      { url: "https://api.instantly.ai/api/v2/campaigns/camp_1", method: "PATCH" },
    ]);
  });
});

describe("updateInstantlyLead", () => {
  it("PATCHes the lead by id", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchSpy = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "lead_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const { outcome } = await updateInstantlyLead("k", "lead_1", { custom_variables: { a: "b" } }, { fetch: fetchSpy });
    expect(outcome).toMatchObject({ kind: "ok", leadId: "lead_1" });
    expect(seen?.url).toBe("https://api.instantly.ai/api/v2/leads/lead_1");
    expect(seen?.init.method).toBe("PATCH");
  });
});

describe("Instantly blocklist", () => {
  it("bulk-creates entries and maps the returned ids by value", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchSpy = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ items: [{ id: "bl_1", bl_value: "Acme.com" }], valid_count: 1, invalid_count: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const { outcome } = await createInstantlyBlocklistEntries("k", ["acme.com", "bad"], { fetch: fetchSpy });
    expect(seen?.url).toBe("https://api.instantly.ai/api/v2/block-lists-entries/bulk-create");
    expect(seen?.init.body).toBe('{"bl_values":["acme.com","bad"]}');
    expect(blocklistEntryIds(outcome.body)).toEqual(new Map([["acme.com", "bl_1"]]));
    expect(blocklistEntryIds(null).size).toBe(0);
  });

  it("deletes an entry without a body or JSON content type", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchSpy = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "bl_1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { outcome } = await deleteInstantlyBlocklistEntry("k", "bl_1", { fetch: fetchSpy });
    expect(outcome.kind).toBe("ok");
    expect(seen?.url).toBe("https://api.instantly.ai/api/v2/block-lists-entries/bl_1");
    expect(seen?.init.method).toBe("DELETE");
    expect(seen?.init.body).toBeUndefined();
    expect(seen?.init.headers).toEqual({ authorization: "Bearer k" });
  });
});
