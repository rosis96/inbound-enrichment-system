/** Lowercase host without scheme, path, port or a leading `www.`; undefined if nothing usable. */
export function normaliseDomain(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  let value = input.trim().toLowerCase();
  if (value.includes("@")) value = value.slice(value.lastIndexOf("@") + 1);
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0] ?? "";
  value = value.replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : undefined;
}

export function normaliseEmail(input: string | null | undefined): string | undefined {
  const value = input?.trim().toLowerCase();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/** True if `domain` equals an entry or is a subdomain of it. */
export function domainInList(domain: string, list: readonly string[]): boolean {
  return list.some((entry) => {
    const target = normaliseDomain(entry);
    return target !== undefined && (domain === target || domain.endsWith(`.${target}`));
  });
}

/** Path of a URL (or a bare path), lowercased, without query, hash or trailing slash. */
export function urlPath(input: string): string {
  let path = input.trim();
  try {
    path = new URL(path, "http://x").pathname;
  } catch {
    path = path.split(/[?#]/)[0] ?? "";
  }
  path = path.toLowerCase().replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/** Glob match where `*` matches any run of characters (including `/`). Case-insensitive. */
export function pathMatches(path: string, pattern: string): boolean {
  const normalisedPattern = pattern.trim().toLowerCase().replace(/\/+$/, "") || "/";
  const regex = new RegExp(`^${normalisedPattern.split("*").map(escapeRegex).join(".*")}$`);
  return regex.test(path);
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  usa: "US",
  "united states of america": "US",
  america: "US",
};

// Deprecated or reserved codes that share an English name with a current code (UK/GB, DD/DE, ...).
const NON_CURRENT_CODES = new Set(["AN", "BU", "CS", "DD", "EU", "EZ", "FX", "NT", "QO", "SU", "TP", "UK", "UN", "YU", "ZR"]);

let countryNames: Map<string, string> | undefined;

function countryNameIndex(): Map<string, string> {
  if (countryNames) return countryNames;
  countryNames = new Map();
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (NON_CURRENT_CODES.has(code)) continue;
      const name = names.of(code);
      if (name && name !== code) countryNames.set(name.toLowerCase(), code);
    }
  }
  return countryNames;
}

/** ISO 3166 alpha-2 code from a code or English country name; undefined if unrecognised. */
export function countryCode(input: string | null | undefined): string | undefined {
  const value = input?.trim();
  if (!value) return undefined;
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase() === "UK" ? "GB" : value.toUpperCase();
  const lower = value.toLowerCase();
  return COUNTRY_ALIASES[lower] ?? countryNameIndex().get(lower);
}
