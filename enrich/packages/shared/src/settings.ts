import { z } from "zod";
import { dependencyOrder } from "./variable-template";

export const DEFAULT_FREE_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "live.com",
  "msn.com",
];

export const SENIORITIES = ["owner", "c_level", "director", "manager", "ic"] as const;
export const Seniority = z.enum(SENIORITIES);
export type Seniority = z.infer<typeof Seniority>;

const stringList = z.array(z.string().trim().min(1)).default([]);

export const IcpSettings = z.object({
  countries: stringList,
  employeeRanges: stringList,
  industriesInclude: stringList,
  industriesExclude: stringList,
  titleKeywords: stringList,
  titleExcludeKeywords: stringList,
  seniorities: z.array(Seniority).default([]),
  minScore: z.number().int().min(0).max(100).default(80),
});

export const PageSettings = z.object({
  highIntent: stringList,
  mediumIntent: stringList,
  ignore: stringList,
  topicMap: z.array(z.object({ pattern: z.string().min(1), topic: z.string().min(1) })).default([]),
});

export const ContactSettings = z.object({
  maxPerCompany: z.number().int().min(1).max(10).default(1),
  usePeopleSearchWhenEmpty: z.boolean().default(false),
});

const campaignId = z.uuid();

export const CampaignSettings = z.object({
  high: campaignId.optional(),
  medium: campaignId.optional(),
  low: campaignId.optional(),
  // Empty until the client's Instantly campaign exists; push fails with `no_campaign` meanwhile.
  default: z.union([campaignId, z.literal("")]).default(""),
  // Leads that could not be personalised (website unreadable or an AI variable missing) go here, without AI variables.
  generic: z.union([campaignId, z.literal("")]).default(""),
});

export const CopySettings = z.object({
  senderName: z.string().default(""),
  companyDescription: z.string().default(""),
  offer: z.string().default(""),
  // What the client can actually deliver, one per entry; the writer picks only the relevant ones.
  services: stringList,
  // Approved proof the writer may cite: case studies, research, figures. Nothing else is claimed.
  proof: stringList,
  bannedPhrases: stringList,
  tone: z.string().default("friendly, concise, professional"),
  // Writes the client's AI variables for every lead before it is pushed.
  aiVariablesEnabled: z.boolean().default(true),
  // When true, a lead missing any AI variable fails instead of being pushed without it.
  requireAiVariables: z.boolean().default(false),
});

const variableName = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/, "must start with a letter and use only letters, digits and _ (max 50)");

/** Variables the push step always sets from lead data; other variables cannot reuse these names. */
export const BUILTIN_INSTANTLY_VARIABLES = [
  "email",
  "firstName",
  "lastName",
  "companyName",
  "website",
  "jobTitle",
  "industry",
  "country",
  "icpScore",
  "intentLevel",
  "intentTopic",
  "pagesVisited",
  "enrichLeadId",
] as const;

/** Placeholders Instantly fills itself (lead fields and sending account), usable in sequences. */
export const INSTANTLY_SYSTEM_PLACEHOLDERS = [
  "firstName",
  "lastName",
  "email",
  "companyName",
  "website",
  "phone",
  "personalization",
  "sendingAccountFirstName",
  "accountSignature",
] as const;

/** One AI-written variable, e.g. `personalized_first_line`, sent to Instantly as a custom variable. */
export const AiVariable = z
  .object({
    name: variableName,
    // Plain instructions, or a template with {{placeholders}} (see variable-template.ts).
    instructions: z.string().trim().min(1).max(5000),
    minWords: z.number().int().min(1).max(300).default(5),
    maxWords: z.number().int().min(1).max(300).default(25),
    // Hard character cap, e.g. 60 for subject lines.
    maxChars: z.number().int().min(10).max(2000).optional(),
    examples: z.array(z.string().trim().min(1)).max(10).default([]),
    // Variables written first and handed to this one; {{name}} references in the instructions count too.
    dependsOn: z.array(variableName).max(9).optional(),
    // Exact sentence count and required opening; override the same rules written in the instructions.
    sentences: z.number().int().min(1).max(10).optional(),
    startsWith: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => v.minWords <= v.maxWords, { message: "min words must be at most max words", path: ["minWords"] });
export type AiVariable = z.output<typeof AiVariable>;

export const DEFAULT_AI_VARIABLES: z.input<typeof AiVariable>[] = [
  {
    name: "subject_line",
    instructions: "A short, curious subject line about the prospect's company or role. Lowercase is fine. No clickbait, no emojis.",
    minWords: 2,
    maxWords: 7,
    maxChars: 60,
    examples: [],
  },
  {
    name: "personalized_first_line",
    instructions:
      "The opening line of the email: one specific, factual observation about the prospect's company or role that leads naturally into the offer.",
    minWords: 8,
    maxWords: 25,
    examples: [],
  },
];

export const CustomVariable = z.object({
  name: variableName,
  // Static text or a template: {{firstName}}, {{companyName|your team}} (text after | is the fallback).
  value: z.string().trim().min(1).max(2000),
});
export type CustomVariable = z.infer<typeof CustomVariable>;

export const SequenceVariant = z.object({
  // Follow-up steps may leave the subject empty to reply in the same thread.
  subject: z.string().trim().max(500).default(""),
  body: z.string().trim().min(1, "body is required").max(20_000),
});
export type SequenceVariant = z.infer<typeof SequenceVariant>;

export const SequenceStep = z.object({
  // Days to wait after the previous step; ignored for the first step.
  waitDays: z.number().int().min(0).max(90).default(3),
  variants: z.array(SequenceVariant).min(1).max(5),
});
export type SequenceStep = z.infer<typeof SequenceStep>;

export const SequenceSettings = z.object({
  steps: z.array(SequenceStep).max(10).default([]),
  // Last time the sequence was created in or pushed to Instantly.
  lastSync: z.object({ at: z.string(), campaignId: z.string() }).optional(),
});

const timeOfDay = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "must be HH:mm");

/** Used when creating or updating the Instantly campaign from the sequence. */
export const InstantlyCampaignSetup = z.object({
  name: z.string().trim().max(255).default(""),
  // IANA name; Instantly accepts only its own list, so its error is shown if this one is rejected.
  timezone: z.string().trim().min(1).default("America/Chicago"),
  from: timeOfDay.default("09:00"),
  to: timeOfDay.default("17:00"),
  // 0 = Sunday … 6 = Saturday.
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  sendingAccounts: z.array(z.email()).default([]),
  dailyLimit: z.number().int().min(1).max(10_000).optional(),
  stopOnReply: z.boolean().default(true),
});

const reserved = new Set(BUILTIN_INSTANTLY_VARIABLES.map((name) => name.toLowerCase()));

export const ClientSettings = z
  .object({
    icp: IcpSettings.prefault({}),
    pages: PageSettings.prefault({}),
    contacts: ContactSettings.prefault({}),
    dedupeDays: z.number().int().min(0).max(3650).default(60),
    freeEmailDomains: z.array(z.string().trim().toLowerCase().min(1)).default(DEFAULT_FREE_EMAIL_DOMAINS),
    // Client's own domains: leads from these are gated out.
    ownDomains: z.array(z.string().trim().toLowerCase().min(1)).default([]),
    campaigns: CampaignSettings.prefault({}),
    copy: CopySettings.prefault({}),
    aiVariables: z.array(AiVariable).max(10).default(DEFAULT_AI_VARIABLES as z.output<typeof AiVariable>[]),
    customVariables: z.array(CustomVariable).max(30).default([]),
    sequence: SequenceSettings.prefault({}),
    campaignSetup: InstantlyCampaignSetup.prefault({}),
  })
  .superRefine((settings, ctx) => {
    // AI and custom variables share one namespace in Instantly.
    const seen = new Map<string, string>();
    const check = (list: "aiVariables" | "customVariables", names: string[]) => {
      names.forEach((name, index) => {
        const key = name.toLowerCase();
        const path = [list, index, "name"];
        if (reserved.has(key)) ctx.addIssue({ code: "custom", path, message: `"${name}" is a built-in variable` });
        else if (seen.has(key)) ctx.addIssue({ code: "custom", path, message: `"${name}" is already used by ${seen.get(key)}` });
        seen.set(key, list === "aiVariables" ? "an AI variable" : "a custom variable");
      });
    };
    check("aiVariables", settings.aiVariables.map((v) => v.name));
    check("customVariables", settings.customVariables.map((v) => v.name));

    const aiNames = new Set(settings.aiVariables.map((v) => v.name));
    settings.aiVariables.forEach((variable, index) => {
      for (const dep of variable.dependsOn ?? []) {
        const path = ["aiVariables", index, "dependsOn"];
        if (dep === variable.name) ctx.addIssue({ code: "custom", path, message: "a variable cannot depend on itself" });
        else if (!aiNames.has(dep)) ctx.addIssue({ code: "custom", path, message: `depends on unknown variable "${dep}"` });
      }
    });
    const order = dependencyOrder(settings.aiVariables);
    if (!order.ok) {
      ctx.addIssue({ code: "custom", path: ["aiVariables"], message: `circular dependency: ${order.cycle.join(" → ")}` });
    }
  });

export type ClientSettings = z.output<typeof ClientSettings>;
export type ClientSettingsInput = z.input<typeof ClientSettings>;

export function parseClientSettings(value: unknown): ClientSettings {
  return ClientSettings.parse(value ?? {});
}

/** Every variable a sequence can reference for this client. */
export function knownPlaceholders(settings: ClientSettings): string[] {
  return [
    ...new Set([
      ...INSTANTLY_SYSTEM_PLACEHOLDERS,
      ...BUILTIN_INSTANTLY_VARIABLES,
      ...settings.aiVariables.map((v) => v.name),
      ...settings.customVariables.map((v) => v.name),
    ]),
  ];
}

/** App-wide integration settings from the Integrations page; each blank value falls back to .env. */
export const IntegrationSettings = z.object({
  openaiApiKeyEnc: z.string().min(1).optional(),
  openaiModel: z.string().trim().min(1).max(100).optional(),
  llmPriceInputPer1M: z.number().min(0).max(1000).optional(),
  llmPriceOutputPer1M: z.number().min(0).max(1000).optional(),
  firecrawlApiKeyEnc: z.string().min(1).optional(),
});
export type IntegrationSettings = z.infer<typeof IntegrationSettings>;
