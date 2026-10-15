import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;

/** Internal pages worth reading for sales research, best first. */
const INTERESTING = ["about", "service", "solution", "product", "what-we", "who-we", "project", "portfolio", "propert", "development", "industr", "case", "customer", "client", "pricing", "work"];
/** Low-value pages never followed. */
const SKIP = /(privacy|cookie|terms|legal|login|sign-?in|sign-?up|register|cart|checkout|careers|jobs|blog\/.+|news\/.+|\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4)$)/i;

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export type CrawlOutcome =
  | { kind: "ok"; source: "fetch" | "firecrawl"; pages: CrawledPage[]; text: string }
  | { kind: "failed"; code: string; detail: string };

export interface CrawlOptions {
  fetch?: typeof fetch;
  /** Total characters of text kept across pages. */
  maxChars?: number;
  /** Internal pages read besides the homepage. */
  maxExtraPages?: number;
  timeoutMs?: number;
  firecrawlApiKey?: string;
  /** Tests only: skip the private-address check (DNS is not available offline). */
  allowPrivate?: boolean;
}

// ---------- SSRF guard ----------

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Rejects URLs that are not public http(s) hosts, so lead data cannot make us call internal services. */
async function assertPublicUrl(url: URL, allowPrivate: boolean): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`blocked protocol ${url.protocol}`);
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error(`blocked port ${url.port}`);
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error(`blocked host ${host}`);
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) throw new Error(`blocked private address for ${host}`);
}

// ---------- HTML → text ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", copy: "©" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Readable text of an HTML page: title, meta description, then body text without scripts, nav and footer. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ??
    "";
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|section|article|li|h[1-6]|br|tr|header|main)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1);
  // Drop repeated lines (menus and banners repeated across sections).
  const seen = new Set<string>();
  const unique = lines.filter((line) => (seen.has(line) ? false : (seen.add(line), true)));
  const text = [decodeEntities(description).trim(), ...unique].filter(Boolean).join("\n");
  return { title, text };
}

/** Same-site links that look like about/services/product pages, best first. */
export function interestingLinks(html: string, base: URL, limit: number): URL[] {
  const found = new Map<string, { url: URL; score: number }>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]!), base);
    } catch {
      continue;
    }
    const sameSite = url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
    if (!sameSite || (url.protocol !== "http:" && url.protocol !== "https:")) continue;
    const path = url.pathname.toLowerCase();
    if (path === "/" || path === "" || SKIP.test(path) || path.split("/").filter(Boolean).length > 2) continue;
    const rank = INTERESTING.findIndex((word) => path.includes(word));
    if (rank === -1) continue;
    url.hash = "";
    url.search = "";
    const key = url.href.replace(/\/$/, "");
    if (!found.has(key)) found.set(key, { url, score: rank });
  }
  return [...found.values()].sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.url);
}

// ---------- fetching ----------

async function fetchHtml(start: URL, options: Required<Pick<CrawlOptions, "timeoutMs" | "allowPrivate">> & { fetch: typeof fetch }) {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url, options.allowPrivate);
    const response = await options.fetch(url, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (type && !type.includes("html")) throw new Error(`not HTML (${type})`);
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return { url, html };
  }
  throw new Error("too many redirects");
}

async function firecrawl(url: string, apiKey: string, doFetch: typeof fetch, timeoutMs: number): Promise<CrawledPage | null> {
  const response = await doFetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(timeoutMs * 3),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: { markdown?: string; metadata?: { title?: string } } };
  const text = body.data?.markdown?.trim();
  return text ? { url, title: body.data?.metadata?.title ?? "", text } : null;
}

/** Below this much text the page is probably rendered by JavaScript, so the fallback is tried. */
const MIN_USEFUL_CHARS = 400;

/**
 * Reads the homepage and a few about/services pages of `domain` and returns their text.
 * Never throws; network and policy errors become a `failed` outcome.
 */
export async function crawlCompanySite(domain: string, options: CrawlOptions = {}): Promise<CrawlOutcome> {
  const doFetch = options.fetch ?? fetch;
  const maxChars = options.maxChars ?? 12_000;
  const settings = { fetch: doFetch, timeoutMs: options.timeoutMs ?? 12_000, allowPrivate: options.allowPrivate ?? false };

  let home: { url: URL; html: string } | undefined;
  let lastError = "";
  for (const candidate of [`https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`]) {
    try {
      home = await fetchHtml(new URL(candidate), settings);
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (lastError.startsWith("blocked")) return { kind: "failed", code: "blocked_address", detail: lastError };
    }
  }

  const pages: CrawledPage[] = [];
  if (home) {
    pages.push({ url: home.url.href, ...htmlToText(home.html) });
    const links = interestingLinks(home.html, home.url, options.maxExtraPages ?? 4);
    const extra = await Promise.all(
      links.map(async (link) => {
        try {
          const page = await fetchHtml(link, settings);
          return { url: page.url.href, ...htmlToText(page.html) };
        } catch {
          return null;
        }
      }),
    );
    pages.push(...extra.filter((p): p is CrawledPage => p !== null && p.text.length > 0));
  }

  let source: "fetch" | "firecrawl" = "fetch";
  const homeChars = pages[0]?.text.length ?? 0;
  if (homeChars < MIN_USEFUL_CHARS && options.firecrawlApiKey) {
    try {
      const page = await firecrawl(home?.url.href ?? `https://${domain}/`, options.firecrawlApiKey, doFetch, settings.timeoutMs);
      if (page && page.text.length > homeChars) {
        pages.splice(0, 1, page);
        source = "firecrawl";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (pages.length === 0 || pages.every((p) => p.text.length === 0)) {
    return { kind: "failed", code: home ? "no_text" : "unreachable", detail: lastError || "page has no readable text" };
  }

  // Share the character budget: homepage first, then each extra page in order.
  let budget = maxChars;
  const parts: string[] = [];
  for (const page of pages) {
    if (budget <= 200) break;
    const text = page.text.slice(0, page === pages[0] ? Math.min(budget, Math.ceil(maxChars * 0.5)) : budget);
    // The Source line lets facts found in the text be linked back to their page.
    parts.push(`## ${page.title || page.url}\nSource: ${page.url}\n${text}`);
    budget -= text.length;
  }
  return { kind: "ok", source, pages, text: parts.join("\n\n") };
}
