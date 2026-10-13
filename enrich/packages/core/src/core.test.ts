import { parseClientSettings } from "@enrich/shared";
import { describe, expect, it } from "vitest";
import high from "../../../scripts/samples/happierleads-high.json";
import low from "../../../scripts/samples/happierleads-low.json";
import { evaluateGates, type GateInput } from "./gates";
import { PayloadError, parseHappierleadsPayload } from "./happierleads";
import { parseEmployeeRange, scoreIcp } from "./icp";
import { buildInstantlyLead } from "./instantly";
import { countryCode, normaliseDomain, pathMatches, urlPath } from "./normalise";
import { buildVariablesPrompt, checkVariable, pickVariables } from "./personalise";
import { renderTemplate, templatePlaceholders } from "./template";

// Mirrors the demo client's seeded settings.
const settings = parseClientSettings({
  icp: {
    countries: ["GB", "US", "IE"],
    employeeRanges: ["11-50", "51-200", "201-500"],
    industriesInclude: ["Software", "Marketing", "Professional Services"],
    industriesExclude: ["Gambling"],
    titleKeywords: ["owner", "founder", "director", "head of", "manager"],
    titleExcludeKeywords: ["intern", "student", "assistant"],
    seniorities: ["owner", "c_level", "director", "manager"],
  },
  pages: {
    highIntent: ["/pricing", "/contact", "/services/*"],
    mediumIntent: ["/about*", "/case-studies*"],
    ignore: ["/careers*", "/blog", "/privacy*"],
    topicMap: [{ pattern: "/services/seo*", topic: "SEO" }],
  },
  ownDomains: ["demo-agency.example"],
});

describe("normalise helpers", () => {
  it("normalises domains", () => {
    expect(normaliseDomain("https://WWW.Example.co.uk:443/path?q=1")).toBe("example.co.uk");
    expect(normaliseDomain("jane@Example.com")).toBe("example.com");
    expect(normaliseDomain("not a domain")).toBeUndefined();
    expect(normaliseDomain(null)).toBeUndefined();
  });

  it("matches paths with globs", () => {
    expect(urlPath("https://x.example/Pricing/?a=1")).toBe("/pricing");
    expect(pathMatches("/services/seo/audit", "/services/*")).toBe(true);
    expect(pathMatches("/services", "/services/*")).toBe(false);
    expect(pathMatches("/pricing", "/pricing")).toBe(true);
    expect(pathMatches("/pricing-old", "/pricing")).toBe(false);
  });

  it("resolves country names and codes", () => {
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("uk")).toBe("GB");
    expect(countryCode("Germany")).toBe("DE");
    expect(countryCode("Atlantis")).toBeUndefined();
  });

  it("parses employee ranges", () => {
    expect(parseEmployeeRange("1,001-5,000")).toEqual([1001, 5000]);
    expect(parseEmployeeRange("10000+")).toEqual([10000, Number.POSITIVE_INFINITY]);
    expect(parseEmployeeRange("42")).toEqual([42, 42]);
    expect(parseEmployeeRange("unknown")).toBeUndefined();
  });
});

describe("parseHappierleadsPayload", () => {
  it("parses the sample payload", () => {
    const visit = parseHappierleadsPayload(high);
    expect(visit.company).toMatchObject({ domain: "northwind-analytics.example", country: "GB", employeeRange: "11-50" });
    expect(visit.visitedAt?.toISOString()).toBe("2026-10-11T09:14:00.000Z");
    expect(visit.pages.map((p) => p.path)).toEqual(["/", "/services/seo-audits", "/pricing"]);
    expect(visit.referrer).toBe("https://www.google.com/");
    expect(visit.contacts).toHaveLength(3);
    expect(visit.contacts[0]).toMatchObject({
      email: "priya@northwind-analytics.example",
      title: "Founder & CEO",
      seniority: "owner",
    });
    expect(visit.contacts[2]?.email).toBeUndefined();
  });

  it("tolerates nulls, wrappers and alternative names", () => {
    const visit = parseHappierleadsPayload({
      data: {
        website: "acme.example",
        name: null,
        country_code: "us",
        created_at: 1760000000,
        session: null,
        people: [{ name: "Ada Lovelace", jobTitle: null, email: "  ADA@acme.example " }],
      },
    });
    expect(visit.company).toMatchObject({ domain: "acme.example", country: "US" });
    expect(visit.company.name).toBeUndefined();
    expect(visit.pages).toEqual([]);
    expect(visit.visitedAt).toBeInstanceOf(Date);
    expect(visit.contacts[0]).toMatchObject({ firstName: "Ada", lastName: "Lovelace", email: "ada@acme.example" });
  });

  it("rejects payloads without a domain", () => {
    expect(() => parseHappierleadsPayload({ company: { name: "No Domain" } })).toThrow(PayloadError);
    expect(() => parseHappierleadsPayload(null)).toThrow(PayloadError);
  });
});

describe("evaluateGates", () => {
  const base: GateInput = {
    domain: "northwind-analytics.example",
    contacts: [
      { id: "c1", email: "priya@northwind-analytics.example" },
      { id: "c2", email: "someone@gmail.com" },
      { id: "c3", email: "ceo@northwind-analytics.example" },
      { id: "c4", email: null },
    ],
    suppression: [{ kind: "email", value: "ceo@northwind-analytics.example", reason: "do_not_contact" }],
    duplicate: null,
    settings,
  };

  it("passes and filters contacts", () => {
    const result = evaluateGates(base);
    expect(result.passed).toBe(true);
    expect(result.eligibleContactIds).toEqual(["c1"]);
    expect(result.excludedContacts.map((c) => c.reason)).toEqual([
      "free_email_domain",
      "suppressed_email:do_not_contact",
      "no_email",
    ]);
  });

  it("gates out own, free, suppressed and duplicate domains", () => {
    expect(evaluateGates({ ...base, domain: "app.demo-agency.example" }).reason).toBe("own_domain");
    expect(evaluateGates({ ...base, domain: "gmail.com" }).reason).toBe("free_email_domain");
    const competitor = { kind: "domain" as const, value: "northwind-analytics.example", reason: "competitor" as const };
    expect(evaluateGates({ ...base, suppression: [competitor] }).reason).toBe("suppressed_domain:competitor");
    const duplicate = { id: "l0", status: "pushed", createdAt: new Date("2026-10-01") };
    expect(evaluateGates({ ...base, duplicate }).reason).toBe("duplicate");
  });
});

describe("scoreIcp", () => {
  it("scores the high sample 100 with reasons and picks the founder", () => {
    const visit = parseHappierleadsPayload(high);
    const contacts = visit.contacts.map((c, i) => ({ id: `c${i}`, title: c.title ?? null, seniority: c.seniority ?? null }));
    const result = scoreIcp({
      company: { country: "GB", employeeRange: "11-50", industry: "Software" },
      pages: visit.pages,
      contacts: contacts.slice(0, 2),
      settings,
    });
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.contactId).toBe("c0");
    expect(result.intent).toMatchObject({ level: "high", topic: "SEO" });
    expect(result.reasons.map((r) => r.factor)).toEqual(["country", "size", "industry", "title", "intent"]);
  });

  it("scores the low sample below the default threshold of 80", () => {
    const visit = parseHappierleadsPayload(low);
    const result = scoreIcp({
      company: { country: visit.company.country ?? null, employeeRange: "1001-5000", industry: "Retail" },
      pages: visit.pages,
      contacts: [{ id: "c0", title: "Store Assistant", seniority: null }],
      settings,
    });
    expect(result.score).toBeLessThan(80);
    expect(result.passed).toBe(false);
    expect(result.intent.level).toBe("low");
  });

  it("disqualifies excluded industries", () => {
    const result = scoreIcp({
      company: { country: "GB", employeeRange: "11-50", industry: "Online Gambling" },
      pages: [{ url: "/pricing", path: "/pricing" }],
      contacts: [{ id: "c0", title: "Founder", seniority: null }],
      settings,
    });
    expect(result.score).toBe(0);
  });
});

describe("buildInstantlyLead", () => {
  it("builds a request with string-only custom variables", () => {
    const body = buildInstantlyLead({
      campaignId: "0b5d6f7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
      contact: { email: "priya@northwind-analytics.example", firstName: "Priya", lastName: null, title: "Founder" },
      company: { domain: "northwind-analytics.example", name: "Northwind", industry: null, country: "GB" },
      lead: {
        id: "l1",
        icpScore: 100,
        intentLevel: "high",
        intentTopic: "SEO",
        pages: [{ url: "/pricing", path: "/pricing" }],
      },
    });
    expect(body.skip_if_in_workspace).toBe(true);
    expect(body.last_name).toBeUndefined();
    expect(body.custom_variables).toEqual({
      jobTitle: "Founder",
      country: "GB",
      icpScore: "100",
      intentLevel: "high",
      intentTopic: "SEO",
      pagesVisited: "/pricing",
      enrichLeadId: "l1",
    });
    expect(Object.values(body.custom_variables).every((v) => typeof v === "string")).toBe(true);
  });
});

describe("buildInstantlyLead custom variables", () => {
  const base = {
    campaignId: null,
    contact: {
      email: "a@b.example",
      firstName: null,
      lastName: null,
      title: null,
      aiVariables: { personalized_first_line: "Loved the new pricing page.", subject_line: "quick idea" },
    },
    company: { domain: "b.example", name: "Bee", industry: null, country: null },
    lead: { id: "l1", icpScore: 90, intentLevel: null, intentTopic: "SEO", pages: [] },
  };

  it("sends AI variables and rendered custom variables", () => {
    const body = buildInstantlyLead({
      ...base,
      customVariables: [
        { name: "calendarLink", value: "https://cal.com/sam" },
        { name: "greeting", value: "Hi {{firstName|there}}" },
        { name: "pitch", value: "{{intentTopic}} help for {{companyName}}" },
        { name: "opener", value: "{{personalized_first_line}}" },
        { name: "empty", value: "{{industry}}" },
      ],
    });
    expect(body.custom_variables).toMatchObject({
      personalized_first_line: "Loved the new pricing page.",
      subject_line: "quick idea",
      calendarLink: "https://cal.com/sam",
      greeting: "Hi there",
      pitch: "SEO help for Bee",
      opener: "Loved the new pricing page.",
    });
    expect(body.custom_variables.empty).toBeUndefined();
  });
});

describe("renderTemplate", () => {
  it("fills values, fallbacks and blanks", () => {
    expect(renderTemplate("{{ a }}-{{b|x}}-{{c}}", { a: "1", b: " " })).toBe("1-x-");
    expect(templatePlaceholders("{{a}} {{b|y}} {{a}}")).toEqual(["a", "b"]);
  });
});

const firstLine = { name: "personalized_first_line", instructions: "x", minWords: 4, maxWords: 12, examples: [] };
const subject = { name: "subject_line", instructions: "x", minWords: 1, maxWords: 6, maxChars: 30, examples: [] };

describe("checkVariable", () => {
  it("passes a clean value and flags guardrail problems", () => {
    expect(checkVariable(firstLine, "Your ops team clearly ships fast.", [])).toEqual([]);
    const problems = checkVariable(firstLine, "I saw you visited our site, {name}. Let's circle back now please okay", ["circle back"]);
    expect(problems).toHaveLength(4);
    expect(checkVariable(subject, "a subject that is far too long for it", [])).toHaveLength(2);
  });
});

describe("checkVariable website-visit phrases", () => {
  it("allows destination names with Visit but blocks talk about the prospect's visit", () => {
    const v = { name: "line", instructions: "x", minWords: 1, maxWords: 40, examples: [] };
    expect(checkVariable(v, "Visit Seattle's new waterfront campaign puts the food scene front and centre.", [])).toEqual([]);
    expect(checkVariable(v, "visit.brussels has a strong autumn events calendar.", [])).toEqual([]);
    for (const bad of [
      "I saw you visited our pricing page last week.",
      "Thanks for checking out our site recently.",
      "Following your recent visit, a quick idea.",
      "Our tracking shows strong interest from your team.",
      "Noticed you were looking at our services.",
    ]) {
      expect(checkVariable(v, bad, [])).toContain("mentions the website visit or tracking");
    }
  });
});

describe("pickVariables", () => {
  it("keeps the first passing candidate and reports the rest", () => {
    const picked = pickVariables(
      [firstLine, subject],
      { variables: { personalized_first_line: ["too short", "Your ops team clearly ships fast."], subject_line: "[x]" } },
      [],
    );
    expect(picked.values).toEqual({ personalized_first_line: "Your ops team clearly ships fast." });
    expect(Object.keys(picked.rejected)).toEqual(["subject_line"]);
  });
});

describe("buildVariablesPrompt", () => {
  it("lists every variable with its limits and the company facts", () => {
    const settings = parseClientSettings({ copy: { senderName: "Sam", bannedPhrases: ["synergy"] } });
    const prompt = buildVariablesPrompt({
      copy: settings.copy,
      variables: settings.aiVariables,
      contact: { firstName: "Priya", lastName: null, title: "Founder" },
      company: { domain: "b.example", name: "Bee", industry: "Software", country: "GB", summary: null },
      intentTopic: null,
      pages: [],
    });
    expect(prompt).toContain("- subject_line (2-7 words, at most 60 characters)");
    expect(prompt).toContain("- personalized_first_line (8-25 words)");
    expect(prompt).toContain("Industry: Software");
    expect(prompt).toContain("Never use these phrases: synergy");
  });
});
