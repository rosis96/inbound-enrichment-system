import { describe, expect, it } from "vitest";
import { testLeadFlags } from "./lead";
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

describe("customVariables", () => {
  it("defaults to none and accepts valid names", () => {
    expect(parseClientSettings({}).customVariables).toEqual([]);
    expect(ClientSettings.safeParse({ customVariables: [{ name: "calendarLink", value: "https://cal.com/x" }] }).success).toBe(true);
  });

  it("rejects bad, built-in and duplicate names", () => {
    expect(ClientSettings.safeParse({ customVariables: [{ name: "1bad", value: "x" }] }).success).toBe(false);
    expect(ClientSettings.safeParse({ customVariables: [{ name: "FirstName", value: "x" }] }).success).toBe(false);
    expect(ClientSettings.safeParse({ customVariables: [{ name: "subject_line", value: "x" }] }).success).toBe(false);
    expect(
      ClientSettings.safeParse({ customVariables: [{ name: "a", value: "x" }, { name: "A", value: "y" }] }).success,
    ).toBe(false);
  });
});

describe("aiVariables and sequence", () => {
  it("defaults to subject_line and personalized_first_line", () => {
    expect(parseClientSettings({}).aiVariables.map((v) => v.name)).toEqual(["subject_line", "personalized_first_line"]);
  });

  it("rejects bad word ranges and accepts a sequence", () => {
    expect(ClientSettings.safeParse({ aiVariables: [{ name: "x", instructions: "y", minWords: 9, maxWords: 3 }] }).success).toBe(false);
    const parsed = parseClientSettings({ sequence: { steps: [{ variants: [{ body: "Hi {{firstName}}" }] }] } });
    expect(parsed.sequence.steps[0]).toEqual({ waitDays: 3, variants: [{ subject: "", body: "Hi {{firstName}}" }] });
  });
});

describe("testLeadFlags", () => {
  it("reads test-lead options and ignores real payloads", () => {
    expect(testLeadFlags({ company: {} })).toBeNull();
    expect(testLeadFlags({ _enrichTest: { skipDedupe: true } })).toEqual({ dryRun: true, skipDedupe: true, freshResearch: false });
    expect(testLeadFlags(null)).toBeNull();
  });
});
