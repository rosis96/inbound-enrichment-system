import { describe, expect, it } from "vitest";
import { ClientSettings, DEFAULT_FREE_EMAIL_DOMAINS, parseClientSettings } from "./settings";

describe("ClientSettings", () => {
  it("fills every default from an empty object", () => {
    const settings = parseClientSettings({});
    expect(settings.icp.minScore).toBe(80);
    expect(settings.icp.countries).toEqual([]);
    expect(settings.contacts).toEqual({ maxPerCompany: 1, usePeopleSearchWhenEmpty: false });
    expect(settings.dedupeDays).toBe(60);
    expect(settings.freeEmailDomains).toEqual(DEFAULT_FREE_EMAIL_DOMAINS);
    expect(settings.campaigns.default).toBe("");
    expect(settings.pages.topicMap).toEqual([]);
  });

  it("treats null as empty settings", () => {
    expect(parseClientSettings(null).icp.minScore).toBe(80);
  });

  it("keeps partial nested values and defaults the rest", () => {
    const settings = parseClientSettings({ icp: { minScore: 70, countries: ["GB"] } });
    expect(settings.icp.minScore).toBe(70);
    expect(settings.icp.countries).toEqual(["GB"]);
    expect(settings.icp.titleKeywords).toEqual([]);
  });

  it("rejects invalid values", () => {
    expect(ClientSettings.safeParse({ icp: { minScore: 101 } }).success).toBe(false);
    expect(ClientSettings.safeParse({ icp: { seniorities: ["boss"] } }).success).toBe(false);
    expect(ClientSettings.safeParse({ campaigns: { default: "not-a-uuid" } }).success).toBe(false);
  });
});
