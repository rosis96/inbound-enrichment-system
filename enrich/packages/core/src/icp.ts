import type { ClientSettings, IcpReason, IntentLevel, LeadPage } from "@enrich/shared";
import { countryCode, pathMatches } from "./normalise";
import { SENIORITY_RANK, seniorityFromTitle } from "./seniority";

/** Each factor is worth up to 20 points; five factors make 100. */
export const FACTOR_MAX = 20;

export interface IcpCompany {
  country: string | null;
  employeeRange: string | null;
  industry: string | null;
}

export interface IcpContact {
  id: string;
  title: string | null;
  seniority: string | null;
}

export interface Intent {
  level: IntentLevel;
  topic: string | null;
  highPages: string[];
  mediumPages: string[];
}

export interface IcpResult {
  score: number;
  passed: boolean;
  reasons: IcpReason[];
  intent: Intent;
  /** Contact used for the title factor, if any. */
  contactId: string | null;
}

const lowerIncludes = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());

export function classifyIntent(pages: LeadPage[], settings: ClientSettings["pages"]): Intent {
  const relevant = pages.filter((page) => !settings.ignore.some((pattern) => pathMatches(page.path, pattern)));
  const highPages = unique(relevant.filter((p) => settings.highIntent.some((pat) => pathMatches(p.path, pat))).map((p) => p.path));
  const mediumPages = unique(
    relevant.filter((p) => settings.mediumIntent.some((pat) => pathMatches(p.path, pat))).map((p) => p.path),
  );
  const topic = settings.topicMap.find((entry) => relevant.some((page) => pathMatches(page.path, entry.pattern)))?.topic ?? null;
  const level: IntentLevel = highPages.length > 0 ? "high" : mediumPages.length > 0 ? "medium" : "low";
  return { level, topic, highPages, mediumPages };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Best contact for outreach: title keyword match first, then seniority. Excluded titles never win. */
export function pickBestContact<C extends IcpContact>(contacts: C[], icp: ClientSettings["icp"]): C | undefined {
  const scored = contacts
    .filter((c) => !c.title || !icp.titleExcludeKeywords.some((k) => lowerIncludes(c.title!, k)))
    .map((c) => ({
      contact: c,
      keyword: c.title && icp.titleKeywords.some((k) => lowerIncludes(c.title!, k)) ? 1 : 0,
      seniority: SENIORITY_RANK[contactSeniority(c)] ?? 0,
    }));
  scored.sort((a, b) => b.keyword - a.keyword || b.seniority - a.seniority);
  return scored[0]?.contact;
}

function contactSeniority(contact: IcpContact): string {
  return contact.seniority ?? (contact.title ? seniorityFromTitle(contact.title) : "ic");
}

/** Parses "11-50", "51 - 200", "1,001-5,000", "10000+" or "42" into inclusive bounds. */
export function parseEmployeeRange(value: string): [number, number] | undefined {
  const cleaned = value.replace(/,/g, "").replace(/employees?/i, "").trim();
  const range = cleaned.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/);
  if (range) return [Number(range[1]), Number(range[2])];
  const plus = cleaned.match(/^(\d+)\s*\+$/);
  if (plus) return [Number(plus[1]), Number.POSITIVE_INFINITY];
  const single = cleaned.match(/^(\d+)$/);
  if (single) return [Number(single[1]), Number(single[1])];
  return undefined;
}

function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

function reason(factor: string, points: number, detail: string): IcpReason {
  return { factor, points, max: FACTOR_MAX, detail };
}

function countryReason(company: IcpCompany, icp: ClientSettings["icp"]): IcpReason {
  if (icp.countries.length === 0) return reason("country", FACTOR_MAX, "no country filter set");
  const code = countryCode(company.country);
  if (!code) return reason("country", 0, "country unknown");
  const targets = icp.countries.map((c) => countryCode(c) ?? c.toUpperCase());
  return targets.includes(code)
    ? reason("country", FACTOR_MAX, `${code} is a target country`)
    : reason("country", 0, `${code} is not in ${targets.join(", ")}`);
}

function sizeReason(company: IcpCompany, icp: ClientSettings["icp"]): IcpReason {
  if (icp.employeeRanges.length === 0) return reason("size", FACTOR_MAX, "no size filter set");
  const range = company.employeeRange ? parseEmployeeRange(company.employeeRange) : undefined;
  if (!range) return reason("size", 0, `employee range unknown${company.employeeRange ? ` ("${company.employeeRange}")` : ""}`);
  const match = icp.employeeRanges.find((target) => {
    const bounds = parseEmployeeRange(target);
    return bounds !== undefined && rangesOverlap(range, bounds);
  });
  return match
    ? reason("size", FACTOR_MAX, `${company.employeeRange} employees matches ${match}`)
    : reason("size", 0, `${company.employeeRange} employees is outside ${icp.employeeRanges.join(", ")}`);
}

function industryReason(company: IcpCompany, icp: ClientSettings["icp"]): { reason: IcpReason; excluded: boolean } {
  const industry = company.industry;
  const excludedBy = industry ? icp.industriesExclude.find((x) => lowerIncludes(industry, x) || lowerIncludes(x, industry)) : undefined;
  if (excludedBy) return { reason: reason("industry", 0, `${industry} is an excluded industry (${excludedBy})`), excluded: true };
  if (icp.industriesInclude.length === 0) return { reason: reason("industry", FACTOR_MAX, "no industry filter set"), excluded: false };
  if (!industry) return { reason: reason("industry", 0, "industry unknown"), excluded: false };
  const match = icp.industriesInclude.find((x) => lowerIncludes(industry, x) || lowerIncludes(x, industry));
  return {
    reason: match
      ? reason("industry", FACTOR_MAX, `${industry} matches ${match}`)
      : reason("industry", 0, `${industry} is not a target industry`),
    excluded: false,
  };
}

function titleReason(contact: IcpContact | undefined, icp: ClientSettings["icp"]): IcpReason {
  if (!contact) return reason("title", 0, "no eligible contact");
  if (icp.titleKeywords.length === 0 && icp.seniorities.length === 0) {
    return reason("title", FACTOR_MAX, "no title filter set");
  }
  const title = contact.title;
  if (!title) return reason("title", 0, "contact has no title");
  const keyword = icp.titleKeywords.find((k) => lowerIncludes(title, k));
  if (keyword) return reason("title", FACTOR_MAX, `"${title}" matches keyword "${keyword}"`);
  const seniority = contactSeniority(contact);
  if (icp.seniorities.includes(seniority as never)) {
    return reason("title", FACTOR_MAX / 2, `"${title}" has target seniority ${seniority} but no keyword match`);
  }
  return reason("title", 0, `"${title}" matches no title keyword or target seniority`);
}

function intentReason(intent: Intent): IcpReason {
  if (intent.level === "high") return reason("intent", FACTOR_MAX, `visited high-intent ${intent.highPages.join(", ")}`);
  if (intent.level === "medium") {
    return reason("intent", FACTOR_MAX / 2, `visited medium-intent ${intent.mediumPages.join(", ")}`);
  }
  return reason("intent", 0, "no high- or medium-intent pages visited");
}

export function scoreIcp(input: {
  company: IcpCompany;
  pages: LeadPage[];
  contacts: IcpContact[];
  settings: ClientSettings;
}): IcpResult {
  const { icp } = input.settings;
  const contact = pickBestContact(input.contacts, icp);
  const intent = classifyIntent(input.pages, input.settings.pages);
  const industry = industryReason(input.company, icp);
  const reasons = [
    countryReason(input.company, icp),
    sizeReason(input.company, icp),
    industry.reason,
    titleReason(contact, icp),
    intentReason(intent),
  ];
  // An excluded industry disqualifies the lead regardless of the other factors.
  const score = industry.excluded ? 0 : reasons.reduce((sum, r) => sum + r.points, 0);
  return { score, passed: score >= icp.minScore, reasons, intent, contactId: contact?.id ?? null };
}
