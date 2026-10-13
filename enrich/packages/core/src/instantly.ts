import type { CustomVariable, IntentLevel, LeadPage } from "@enrich/shared";
import { renderTemplate } from "./template";

/** Body for POST https://api.instantly.ai/api/v2/leads. */
export interface InstantlyLeadRequest {
  campaign: string | null;
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  website?: string;
  skip_if_in_workspace: true;
  custom_variables: Record<string, string>;
}

export interface InstantlyLeadInput {
  campaignId: string | null;
  contact: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    /** AI variables written by the personalise step, by name. */
    aiVariables?: Record<string, string> | null;
  };
  company: { domain: string; name: string | null; industry: string | null; country: string | null };
  lead: { id: string; icpScore: number | null; intentLevel: IntentLevel | null; intentTopic: string | null; pages: LeadPage[] };
  /** Client-defined variables; values are templates over the built-in ones. */
  customVariables?: CustomVariable[];
}

/** Drops empty values; Instantly custom variables must be flat strings here. */
function stringsOnly(values: Record<string, string | number | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text !== "") out[key] = text;
  }
  return out;
}

export function buildInstantlyLead({
  campaignId,
  contact,
  company,
  lead,
  customVariables = [],
}: InstantlyLeadInput): InstantlyLeadRequest {
  const pagesVisited = [...new Set(lead.pages.map((page) => page.path))].slice(0, 10).join(", ");
  const builtins = stringsOnly({
    jobTitle: contact.title,
    industry: company.industry,
    country: company.country,
    icpScore: lead.icpScore,
    intentLevel: lead.intentLevel,
    intentTopic: lead.intentTopic,
    pagesVisited,
    enrichLeadId: lead.id,
  });
  const ai = stringsOnly(contact.aiVariables ?? {});
  const templateValues = {
    ...ai,
    ...builtins,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    companyName: company.name,
    website: company.domain,
  };
  const custom = stringsOnly(
    Object.fromEntries(customVariables.map((variable) => [variable.name, renderTemplate(variable.value, templateValues)])),
  );
  return {
    campaign: campaignId,
    email: contact.email,
    ...(contact.firstName ? { first_name: contact.firstName } : {}),
    ...(contact.lastName ? { last_name: contact.lastName } : {}),
    ...(company.name ? { company_name: company.name } : {}),
    website: company.domain,
    skip_if_in_workspace: true,
    custom_variables: { ...custom, ...ai, ...builtins },
  };
}
