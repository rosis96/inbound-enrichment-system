import { z } from "zod";

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
  minScore: z.number().int().min(0).max(100).default(50),
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
});

export const CopySettings = z.object({
  senderName: z.string().default(""),
  companyDescription: z.string().default(""),
  offer: z.string().default(""),
  bannedPhrases: stringList,
  tone: z.string().default("friendly, concise, professional"),
});

export const ClientSettings = z.object({
  icp: IcpSettings.prefault({}),
  pages: PageSettings.prefault({}),
  contacts: ContactSettings.prefault({}),
  dedupeDays: z.number().int().min(0).max(3650).default(60),
  freeEmailDomains: z.array(z.string().trim().toLowerCase().min(1)).default(DEFAULT_FREE_EMAIL_DOMAINS),
  // Client's own domains: leads from these are gated out.
  ownDomains: z.array(z.string().trim().toLowerCase().min(1)).default([]),
  campaigns: CampaignSettings.prefault({}),
  copy: CopySettings.prefault({}),
});

export type ClientSettings = z.output<typeof ClientSettings>;
export type ClientSettingsInput = z.input<typeof ClientSettings>;

export function parseClientSettings(value: unknown): ClientSettings {
  return ClientSettings.parse(value ?? {});
}
