import { describe, expect, it } from "vitest";
import { crawlCompanySite, htmlToText, interestingLinks } from "./index";

const HOME = `<!doctype html><html><head><title>Acme &amp; Co | Payroll</title>
<meta name="description" content="Payroll software for UK small businesses.">
<script>var tracking = 1;</script><style>.x{}</style></head>
<body><nav><a href="/">Home</a><a href="/about-us">About</a></nav>
<main><h1>Run payroll in minutes</h1><p>Acme helps 2,000 UK firms pay staff on time.</p>
<a href="/services/payroll">Payroll service</a><a href="/privacy">Privacy</a><a href="https://other.example/about">Elsewhere</a>
<a href="/blog/2024/a-post">Post</a></main><footer>© Acme</footer></body></html>`;

const PAGES: Record<string, string> = {
  "https://acme.example/": HOME,
  "https://acme.example/about-us": "<title>About</title><p>Founded in 2015 in Leeds.</p>",
  "https://acme.example/services/payroll": "<title>Payroll</title><p>Automatic RTI filing and pensions.</p>",
};

const fakeFetch = (async (input: string | URL) => {
  const url = String(input);
  const html = PAGES[url];
  if (url === "https://old.example/") return new Response(null, { status: 301, headers: { location: "https://acme.example/" } });
  return html
    ? new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
    : new Response("nope", { status: 404 });
}) as unknown as typeof fetch;

describe("htmlToText", () => {
  it("keeps title, description and body text, drops scripts, nav and footer", () => {
    const { title, text } = htmlToText(HOME);
    expect(title).toBe("Acme & Co | Payroll");
    expect(text).toContain("Payroll software for UK small businesses.");
    expect(text).toContain("Acme helps 2,000 UK firms pay staff on time.");
    expect(text).not.toContain("tracking");
    expect(text).not.toContain("© Acme");
  });
});

describe("interestingLinks", () => {
  it("returns same-site about/services pages, skipping privacy, blog posts and other sites", () => {
    const links = interestingLinks(HOME, new URL("https://acme.example/"), 5).map(String);
    expect(links).toEqual(["https://acme.example/about-us", "https://acme.example/services/payroll"]);
  });
});

describe("crawlCompanySite", () => {
  it("reads the homepage plus interesting pages", async () => {
    const outcome = await crawlCompanySite("acme.example", { fetch: fakeFetch, allowPrivate: true });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.source).toBe("fetch");
    expect(outcome.pages.map((p) => p.url)).toEqual([
      "https://acme.example/",
      "https://acme.example/about-us",
      "https://acme.example/services/payroll",
    ]);
    expect(outcome.text).toContain("Founded in 2015 in Leeds.");
    expect(outcome.text).toContain("Automatic RTI filing");
  });

  it("follows redirects", async () => {
    const outcome = await crawlCompanySite("old.example", { fetch: fakeFetch, allowPrivate: true });
    expect(outcome.kind === "ok" && outcome.pages[0]?.url).toBe("https://acme.example/");
  });

  it("refuses private and loopback addresses", async () => {
    const outcome = await crawlCompanySite("127.0.0.1", { fetch: fakeFetch });
    expect(outcome).toMatchObject({ kind: "failed", code: "blocked_address" });
  });

  it("reports unreachable sites", async () => {
    const outcome = await crawlCompanySite("missing.example", { fetch: fakeFetch, allowPrivate: true });
    expect(outcome).toMatchObject({ kind: "failed", code: "unreachable" });
  });
});
