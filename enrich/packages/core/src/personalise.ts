import type { ClientSettings, CompanySummary, FirstLineOutput } from "@enrich/shared";
import { renderTemplate } from "./template";

export const FIRST_LINE_MAX = 200;
export const SUBJECT_LINE_MAX = 60;

export interface FirstLinePromptInput {
  copy: ClientSettings["copy"];
  contact: { firstName: string | null; title: string | null };
  company: { domain: string; name: string | null; industry: string | null; summary: CompanySummary | null };
  intentTopic: string | null;
}

/** Best available description of the company; falls back to name + industry until research has run. */
function companySummaryText(company: FirstLinePromptInput["company"]): string {
  const { summary } = company;
  if (summary) {
    const hooks = summary.personalisationHooks.length > 0 ? ` Details: ${summary.personalisationHooks.join("; ")}.` : "";
    return `${summary.oneLiner} Sells ${summary.whatTheySell} to ${summary.whoTheySellTo}.${hooks}`;
  }
  const name = company.name ?? company.domain;
  return company.industry ? `${name}, a company in ${company.industry}` : name;
}

export function buildFirstLinePrompt(template: string, input: FirstLinePromptInput): string {
  const { copy, contact, company } = input;
  return renderTemplate(template, {
    senderName: copy.senderName || "the sender",
    companyDescription: copy.companyDescription,
    offer: copy.offer,
    tone: copy.tone,
    bannedPhrases: copy.bannedPhrases.join(", ") || "none",
    firstName: contact.firstName || "there",
    title: contact.title || "unknown role",
    companyName: company.name ?? company.domain,
    companySummary: companySummaryText(company),
    intentTopic: input.intentTopic || "general",
  });
}

const TRACKING_WORDS = /\b(visit(ed|ing)?|browsing|browsed|tracking|tracked|our (web)?site|saw you (on|were))\b/i;

/** Problems that make a generated line unsafe to send; empty when it passes. */
export function checkFirstLine(output: FirstLineOutput, bannedPhrases: string[]): string[] {
  const problems: string[] = [];
  const both = `${output.firstLine}\n${output.subjectLine}`;
  if (output.firstLine.length > FIRST_LINE_MAX) problems.push(`first line longer than ${FIRST_LINE_MAX} characters`);
  if (output.subjectLine.length > SUBJECT_LINE_MAX) problems.push(`subject longer than ${SUBJECT_LINE_MAX} characters`);
  if (/[[\]{}<>]/.test(both)) problems.push("contains brackets or placeholders");
  if (TRACKING_WORDS.test(both)) problems.push("mentions the website visit or tracking");
  const lower = both.toLowerCase();
  for (const phrase of bannedPhrases) {
    if (phrase && lower.includes(phrase.toLowerCase())) problems.push(`uses banned phrase "${phrase}"`);
  }
  return problems;
}
