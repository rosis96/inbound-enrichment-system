import type { ClientSettingsInput, PromptKey, SuppressionKind, SuppressionReason } from "@enrich/shared";

export const DEMO_CLIENT_SLUG = "demo";

export const demoSettings: ClientSettingsInput = {
  icp: {
    countries: ["GB", "US", "IE"],
    employeeRanges: ["11-50", "51-200", "201-500"],
    industriesInclude: ["Software", "Marketing", "Professional Services"],
    industriesExclude: ["Gambling"],
    titleKeywords: ["owner", "founder", "director", "head of", "manager"],
    titleExcludeKeywords: ["intern", "student", "assistant"],
    seniorities: ["owner", "c_level", "director", "manager"],
    minScore: 80,
  },
  pages: {
    highIntent: ["/pricing", "/contact", "/services/*"],
    mediumIntent: ["/about*", "/case-studies*"],
    ignore: ["/careers*", "/blog", "/privacy*"],
    topicMap: [
      { pattern: "/services/seo*", topic: "SEO" },
      { pattern: "/services/ppc*", topic: "PPC" },
      { pattern: "/pricing", topic: "Pricing" },
    ],
  },
  contacts: { maxPerCompany: 1, usePeopleSearchWhenEmpty: false },
  dedupeDays: 60,
  ownDomains: ["demo-agency.example"],
  campaigns: { default: "" },
  copy: {
    senderName: "Sam",
    companyDescription: "Demo Agency helps B2B companies grow organic and paid search pipeline.",
    offer: "a free 20-minute search audit",
    bannedPhrases: ["synergy", "circle back", "hope this finds you well"],
    tone: "friendly, concise, professional",
  },
};

export const demoSuppression: { kind: SuppressionKind; value: string; reason: SuppressionReason }[] = [
  { kind: "domain", value: "competitor.example", reason: "competitor" },
  { kind: "domain", value: "bigcustomer.example", reason: "customer" },
  { kind: "email", value: "ceo@opendeal.example", reason: "open_deal" },
  { kind: "email", value: "nope@donotcontact.example", reason: "do_not_contact" },
];

export const promptsV1: Record<PromptKey, string> = {
  company_summary: `You are a B2B research analyst. Summarise the company below for a salesperson.
Use only facts present in the website text. If something is unknown, say "unknown" rather than guessing.

Company domain: {{domain}}
Company name: {{companyName}}

Website text:
"""
{{crawlText}}
"""

Return JSON with:
- oneLiner: one sentence describing what the company does
- whatTheySell: products or services
- whoTheySellTo: target customers
- sizeSignals: any hints about size (team, offices, clients), or "unknown"
- recentNews: a recent announcement if clearly stated, otherwise null
- personalisationHooks: up to 3 specific, factual details that could open a cold email`,

  first_line: `You write the opening line of a cold email from {{senderName}}.
Sender's company: {{companyDescription}}
Offer: {{offer}}
Tone: {{tone}}

Recipient: {{firstName}}, {{title}} at {{companyName}}
Company summary: {{companySummary}}
Topic they are likely interested in: {{intentTopic}}

Rules:
- firstLine: one or two sentences, at most 200 characters, specific to the company's work.
- subjectLine: at most 60 characters.
- Never mention their website visit, browsing, tracking or how we found them.
- No generic flattery, no placeholders, no brackets.
- Avoid these phrases: {{bannedPhrases}}

Return JSON with firstLine and subjectLine.`,
};
