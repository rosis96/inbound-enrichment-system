import { ClientSettings, type ClientSettingsInput, type SuppressionReason } from "@enrich/shared";
import { generateToken } from "@enrich/shared/crypto";
import { getEnv, loadRootEnvFile } from "@enrich/shared/env";
import { eq, sql } from "drizzle-orm";
import { createDb } from "../../client";
import { clients, suppression } from "../../schema";

// Resonance (resonanceco.com), from their onboarding docs of October 2026: ICP & Market Confirmation,
// Positioning & Market Strategy (+ Questions) and the Website Visitor Outreach questionnaire.
// Idempotent: creates the client in dry run, or updates its settings while keeping tokens, dry-run
// switch, Instantly key, campaign ID and sequence sync state. Run against prod with
//   DATABASE_URL=mysql://… pnpm --filter @enrich/db client:resonance

const SLUG = "resonance";

const settings: ClientSettingsInput = {
  icp: {
    // US first, Canada second, Mexico and Caribbean resort markets third (ICP doc, Q9).
    countries: ["US", "CA", "MX", "PR", "AW", "BB", "BS", "BM", "JM", "DO", "KY", "TC", "LC", "AG", "VG", "VI"],
    // "The size of the company is usually not that important" (Q5); project value is checked by hand.
    employeeRanges: [],
    industriesInclude: [
      "Real Estate",
      "Hospitality",
      "Hotel",
      "Resort",
      "Tourism",
      "Travel",
      "Government",
      "Civic",
      "Investment Management",
      "Private Equity",
      "Museum",
      "Entertainment",
      "Spectator Sports",
      "Airlines",
      "Aviation",
      "Maritime",
    ],
    // Contractors don't control strategy; agencies and planners are competitors or influencers, not buyers.
    industriesExclude: ["Construction", "Marketing", "Advertising", "Public Relations", "Design", "Architecture"],
    titleKeywords: [
      "marketing",
      "brand",
      "development",
      "strategy",
      "strategic",
      "destination",
      "placemaking",
      "asset management",
      "hospitality",
      "tourism",
      "economic",
      "investment",
      "acquisitions",
    ],
    titleExcludeKeywords: ["broker", "realtor", "agent", "leasing", "intern", "student", "assistant", "coordinator", "specialist", "analyst"],
    // "As long as the person is Director level or higher, it is worth taking a meeting" (Q13).
    seniorities: ["owner", "c_level", "director"],
    minScore: 80,
  },
  pages: {
    highIntent: [
      "/contact",
      "/fr/contact",
      "/services*",
      "/hotel-resort-development*",
      "/destination-development*",
      "/urban-development*",
      "/economic-development*",
      "/report-download*",
      "/reports/future-of-luxury-travel*",
      "/reports/americas-best-cities*",
    ],
    mediumIntent: ["/work*", "/reports*", "/insights*", "/resonance-report*", "/impact-report*", "/about*", "/team*"],
    ignore: ["/privacy-policy*", "/thank-you*", "/newsletter*", "/wp-*"],
    // First match wins, so specific pages come before their sections.
    topicMap: [
      { pattern: "/reports/future-of-luxury-travel*", topic: "Future of Luxury Travel research" },
      { pattern: "/reports/americas-best-cities*", topic: "America's Best Cities research" },
      { pattern: "/hotel-resort-development*", topic: "hotel and resort development" },
      { pattern: "/work/costa-palmas*", topic: "luxury resort development" },
      { pattern: "/work/amanvari-resort-and-residences*", topic: "branded residences" },
      { pattern: "/work/casa-blake*", topic: "independent hotel branding" },
      { pattern: "/work/one11-residences-at-thompson-central-park*", topic: "branded residences" },
      { pattern: "/urban-development*", topic: "mixed-use and master-planned development" },
      { pattern: "/destination-development*", topic: "destination strategy" },
      { pattern: "/economic-development*", topic: "talent and investment attraction" },
      { pattern: "/reports*", topic: "place research" },
    ],
  },
  contacts: { maxPerCompany: 1, usePeopleSearchWhenEmpty: false },
  // Long, high-value sales cycles: don't re-contact a company within a quarter.
  dedupeDays: 90,
  ownDomains: ["resonanceco.com"],
  copy: {
    senderName: "Resonance",
    companyDescription:
      "Resonance is a place strategy consultancy for destinations, cities and developments. It benchmarks how places perform and how they are perceived (Place Power, World's Best Cities and America's Best Cities rankings, the Future of Luxury Travel study and Ipsos traveler surveys), then carries that research through strategy, brand and creative in one engagement, with senior principals doing the work. Published work includes East Village (Calgary), Costa Palmas and Amanvari Resort & Residences (Baja), Casa Blake and Cypress Village.",
    offer:
      "a short conversation and a free diagnostic of how their place, property or project is perceived and performs against its competitors",
    // What Resonance delivers (Positioning Questions Q1-Q2, ICP Q2); the writer picks the relevant ones.
    services: [
      "Place strategy",
      "Research and market intelligence (perception and performance benchmarking)",
      "Destination positioning",
      "Development and district positioning",
      "Brand strategy",
      "Place branding",
      "Destination marketing",
      "Hospitality positioning",
      "Stakeholder alignment",
      "Naming, identity and launch of major developments",
    ],
    // "Any examples on our website can be shared: resonanceco.com/work" (Positioning Questions Q9), plus
    // their published research (ICP Q14). Add more /work cases here once checked on the site.
    proof: [
      "Future of Luxury Travel study: affluent American travelers (the top 10%) will spend more than $500 billion on leisure travel this year",
      "America's Best Cities ranking: where Americans want to live and work",
      "World's Best Cities ranking of more than 1,000 cities and Place Power benchmarking of all 393 US metro areas",
      "Ipsos traveler surveys across the U.S. and 30 countries on where people want to travel next",
      "East Village, Calgary: place brand and development strategy",
      "Costa Palmas and Amanvari Resort & Residences, Baja: resort and branded-residence positioning",
    ],
    bannedPhrases: [
      "full-service agency",
      "agency of record",
      "the only",
      "unmatched",
      "placemaking",
      "guarantee",
      "boost your brand awareness",
      "logo design",
      "tourism marketing vendor",
      "increase occupancy",
      "increase sales",
      "hope this finds you well",
    ],
    tone: "senior, evidence-led and concise; peer to peer, no hype or superlatives, never promise sales, occupancy, visitation, investment or rankings",
    aiVariablesEnabled: true,
    requireAiVariables: false,
  },
  aiVariables: [
    {
      name: "subject_line",
      instructions:
        "A short, plain subject line about the prospect's place, property or project, or the research topic most relevant to them. Lowercase is fine. No clickbait, no emojis, no question marks.",
      minWords: 2,
      maxWords: 7,
      maxChars: 60,
      examples: ["positioning the next phase", "how affluent travelers see your resort", "where americans want to live"],
    },
    {
      name: "personalized_first_line",
      instructions:
        "The opening line: one specific, factual observation about the prospect's development, hotel/resort portfolio, destination or city (a named project, phase, acquisition, opening or strategy) taken from the company research. Do not compliment architecture or design. Do not mention their website visit.",
      minWords: 8,
      maxWords: 25,
      examples: [],
    },
    {
      name: "research_hook",
      instructions:
        "One sentence linking the single most relevant Resonance research asset to the prospect's segment. Hotel, resort or branded-residence owners/developers: the Future of Luxury Travel study (affluent American travelers, the top 10%, will spend more than $500 billion on leisure travel this year). Mixed-use or master-planned developers: America's Best Cities research on where Americans want to live. Tourism boards/DMOs: traveler surveys across the U.S. and 30 countries on where people want to travel next. Economic development organizations: research on where Americans want to live and work, for competing for talent. State it as what Resonance knows, not as a promise of results.",
      minWords: 12,
      maxWords: 35,
      examples: [
        "Our Future of Luxury Travel study shows affluent American travelers will spend more than $500 billion on leisure travel this year, and what they look for in a resort.",
      ],
    },
  ],
  customVariables: [{ name: "greeting", value: "Hi {{firstName|there}}" }],
  // Starter draft for Resonance to approve; replace before the campaign goes live.
  sequence: {
    steps: [
      {
        waitDays: 0,
        variants: [
          {
            subject: "{{subject_line}}",
            body: "{{greeting}},\n\n{{personalized_first_line}}\n\n{{research_hook}}\n\nResonance measures how places perform and how they are perceived, then turns that into positioning, strategy and brand. Our work includes East Village in Calgary and Costa Palmas with Amanvari in Baja.\n\nWould a short call be useful? We can share a free diagnostic of where {{companyName}} stands against its competitors.\n\n{{accountSignature}}",
          },
        ],
      },
      {
        waitDays: 4,
        variants: [
          {
            subject: "",
            body: "{{greeting}},\n\nA quick follow-up. When a project reaches approval, financing or a change of ownership, the positioning decisions come quickly, and research is cheapest to use before the creative starts.\n\nIf that timing fits {{companyName}}, I'm happy to send over the relevant findings.\n\n{{accountSignature}}",
          },
        ],
      },
      {
        waitDays: 6,
        variants: [
          {
            subject: "",
            body: "{{greeting}},\n\nI'll leave it here. If positioning for a development, property or destination comes up later this year, our recent work is at resonanceco.com/work.\n\n{{accountSignature}}",
          },
        ],
      },
    ],
  },
  campaignSetup: {
    name: "Resonance – Website visitors",
    timezone: "America/New_York",
    from: "09:00",
    to: "17:00",
    days: [1, 2, 3, 4, 5],
    sendingAccounts: [],
    stopOnReply: true,
  },
};

// Known from the docs; the full client / open-deal / declined lists are still to come from Resonance.
const knownSuppression: { value: string; reason: SuppressionReason }[] = [
  { value: "rockymountaineer.com", reason: "open_deal" }, // shortlisted as their marketing agency
  { value: "cmhouston.org", reason: "customer" }, // Children's Museum Houston brand campaign
  { value: "calgarymlc.ca", reason: "customer" }, // East Village since 2008
];

loadRootEnvFile();
const env = getEnv();
const { db, pool } = createDb(env.DATABASE_URL, { max: 1 });

try {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(clients).where(eq(clients.slug, SLUG));
    const previous = existing ? ClientSettings.parse(existing.settings) : undefined;
    const merged = ClientSettings.parse({
      ...settings,
      campaigns: previous?.campaigns ?? {},
      sequence: { ...settings.sequence, lastSync: previous?.sequence.lastSync },
      campaignSetup: { ...settings.campaignSetup, sendingAccounts: previous?.campaignSetup.sendingAccounts ?? [] },
    });

    if (existing) {
      await tx.update(clients).set({ settings: merged, updatedAt: new Date() }).where(eq(clients.id, existing.id));
    } else {
      await tx.insert(clients).values({
        name: "Resonance",
        slug: SLUG,
        dryRun: true,
        autoApprove: false,
        happierleadsToken: generateToken(),
        instantlyWebhookToken: generateToken(),
        settings: merged,
      });
    }

    const [client] = await tx.select().from(clients).where(eq(clients.slug, SLUG));
    if (!client) throw new Error("resonance client missing after upsert");

    await tx
      .insert(suppression)
      .values(knownSuppression.map((row) => ({ clientId: client.id, kind: "domain" as const, value: row.value, reason: row.reason, source: "manual" as const })))
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });

    console.log(`${existing ? "Updated" : "Created"} client "${client.name}" (${client.slug}), dry run: ${client.dryRun}`);
    console.log(`  Happierleads webhook: ${env.APP_URL}/api/hooks/happierleads/${client.happierleadsToken}`);
    console.log(`  Suppression: ${knownSuppression.length} known domains ensured`);
  });
} finally {
  await pool.end();
}
