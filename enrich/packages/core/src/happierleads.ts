import type { LeadPage } from "@enrich/shared";
import { countryCode, normaliseDomain, normaliseEmail, urlPath } from "./normalise";
import { seniorityFromTitle } from "./seniority";

// ASSUMPTION: the Happierleads webhook payload is not documented in this repo. The field names
// below are guesses; each lookup tries several spellings and every field may be null or missing.
// Only the company domain is required.

export interface ParsedCompany {
  domain: string;
  name?: string;
  industry?: string;
  employeeRange?: string;
  revenueRange?: string;
  country?: string;
  linkedinUrl?: string;
}

export interface ParsedContact {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  title?: string;
  seniority?: string;
  linkedinUrl?: string;
  email?: string;
}

export interface ParsedVisit {
  company: ParsedCompany;
  visitedAt?: Date;
  pages: LeadPage[];
  referrer?: string;
  session: unknown;
  contacts: ParsedContact[];
}

export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadError";
  }
}

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const asObj = (value: unknown): Obj => (isObj(value) ? value : {});

/** First value at any of the dotted paths that is a non-empty string (numbers are stringified). */
function str(source: Obj, ...paths: string[]): string | undefined {
  for (const path of paths) {
    let value: unknown = source;
    for (const key of path.split(".")) value = isObj(value) ? value[key] : undefined;
    if (Array.isArray(value)) value = value.find((item) => typeof item === "string" || typeof item === "number");
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function firstArray(source: Obj, ...paths: string[]): unknown[] {
  for (const path of paths) {
    let value: unknown = source;
    for (const key of path.split(".")) value = isObj(value) ? value[key] : undefined;
    if (Array.isArray(value)) return value;
  }
  return [];
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  // Unix seconds or milliseconds.
  const date = /^\d+$/.test(value) ? new Date(Number(value) * (value.length <= 10 ? 1000 : 1)) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseHappierleadsPayload(payload: unknown): ParsedVisit {
  const root = asObj(payload);
  const data = isObj(root.data) ? root.data : root; // ASSUMPTION: may be wrapped in `data`
  const company = isObj(data.company) ? data.company : data; // ASSUMPTION: company fields nested or flat

  const domain = normaliseDomain(
    str(company, "domain", "website", "websiteUrl", "url") ?? str(data, "domain", "companyDomain", "website"),
  );
  if (!domain) throw new PayloadError("payload has no usable company domain");

  // ASSUMPTION: visit details live under `session` (or `visit`, or the first of `sessions`).
  const session =
    data.session ?? data.visit ?? (Array.isArray(data.sessions) ? data.sessions[0] : undefined) ?? null;
  const sessionObj = asObj(session);

  const parsedCompany: ParsedCompany = {
    domain,
    name: str(company, "name", "companyName", "company_name"),
    industry: str(company, "industry", "industries", "category.industry", "sector"),
    employeeRange: str(company, "employees", "employeeRange", "employeesRange", "employee_range", "size", "metrics.employeesRange", "metrics.employees"),
    revenueRange: str(company, "revenue", "revenueRange", "revenue_range", "metrics.estimatedAnnualRevenue"),
    country: countryCode(
      str(company, "country", "countryCode", "country_code", "location.country", "location.countryCode", "geo.country", "geo.countryCode") ??
        str(sessionObj, "country", "location.country"),
    ),
    linkedinUrl: str(company, "linkedin", "linkedinUrl", "linkedin_url", "socials.linkedin", "linkedin.handle"),
  };

  const pages = firstArray(sessionObj, "pages", "pageViews", "page_views", "visitedPages", "urls")
    .concat(firstArray(data, "pages", "pageViews", "visitedPages"))
    .map(parsePage)
    .filter((page): page is LeadPage => page !== undefined);

  const contacts = firstArray(data, "contacts", "people", "employees", "company.contacts")
    .concat(data === company ? [] : firstArray(company, "contacts"))
    .map(parseContact)
    .filter((contact): contact is ParsedContact => contact !== undefined);

  return {
    company: parsedCompany,
    visitedAt: parseDate(
      str(data, "createdAt", "created_at", "visitedAt", "visited_at", "timestamp") ??
        str(sessionObj, "createdAt", "startedAt", "start", "timestamp"),
    ),
    pages: dedupePages(pages),
    referrer: str(sessionObj, "referrer", "referer", "source") ?? str(data, "referrer", "referer"),
    session,
    contacts,
  };
}

function parsePage(value: unknown): LeadPage | undefined {
  if (typeof value === "string") return value.trim() ? { url: value.trim(), path: urlPath(value) } : undefined;
  const page = asObj(value);
  const url = str(page, "url", "href", "page", "path", "pageUrl");
  if (!url) return undefined;
  const at = parseDate(str(page, "at", "timestamp", "createdAt", "visitedAt", "time"));
  return {
    url,
    path: urlPath(url),
    ...(str(page, "title", "pageTitle") ? { title: str(page, "title", "pageTitle") } : {}),
    ...(at ? { at: at.toISOString() } : {}),
  };
}

function dedupePages(pages: LeadPage[]): LeadPage[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = `${page.path}|${page.at ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseContact(value: unknown): ParsedContact | undefined {
  const raw = asObj(value);
  let firstName = str(raw, "firstName", "first_name", "firstname", "name.first");
  let lastName = str(raw, "lastName", "last_name", "lastname", "name.last");
  const fullName =
    str(raw, "fullName", "full_name", "name", "name.full") ?? ([firstName, lastName].filter(Boolean).join(" ") || undefined);
  if (fullName && !firstName && !lastName) {
    const [first, ...rest] = fullName.split(/\s+/);
    firstName = first;
    lastName = rest.join(" ") || undefined;
  }
  const title = str(raw, "title", "position", "jobTitle", "job_title", "role");
  const contact: ParsedContact = {
    firstName,
    lastName,
    fullName,
    title,
    seniority: str(raw, "seniority") ?? (title ? seniorityFromTitle(title) : undefined),
    linkedinUrl: str(raw, "linkedin", "linkedinUrl", "linkedin_url", "socials.linkedin"),
    email: normaliseEmail(str(raw, "email", "emailAddress", "email_address", "emails", "workEmail")),
  };
  return contact.email || contact.fullName || contact.title ? contact : undefined;
}
