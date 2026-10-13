import type { ClientSettings, SequenceStep } from "@enrich/shared";
import type { InstantlyLeadRequest } from "./instantly";
import { renderTemplate, templatePlaceholders } from "./template";

export interface SequenceTemplate {
  id: string;
  name: string;
  description: string;
  steps: SequenceStep[];
}

const step = (waitDays: number, subject: string, body: string): SequenceStep => ({ waitDays, variants: [{ subject, body }] });

/** Starter sequences; they use the default AI variables and a {{calendarLink}} custom variable where noted. */
export const SEQUENCE_TEMPLATES: SequenceTemplate[] = [
  {
    id: "founder-four",
    name: "Founder four-step",
    description: "Personal opener, gentle bump, new angle, polite breakup.",
    steps: [
      step(0, "{{subject_line}}", "Hi {{firstName}},\n\n{{personalized_first_line}}\n\n[One or two lines on what you do and the result you get.]\n\nWorth a quick conversation?\n\n{{sendingAccountFirstName}}"),
      step(3, "", "Hi {{firstName}},\n\nJust bumping this up in case it got buried. Happy to share how this could look for {{companyName}}.\n\n{{sendingAccountFirstName}}"),
      step(4, "a different angle", "Hi {{firstName}},\n\n[A second reason or a short proof point, e.g. a result for a similar company.]\n\nOpen to a 15-minute call next week?\n\n{{sendingAccountFirstName}}"),
      step(5, "", "Hi {{firstName}},\n\nI'll stop here so I don't clutter your inbox. If it's ever useful, just reply and I'll send over the details.\n\n{{sendingAccountFirstName}}"),
    ],
  },
  {
    id: "proof-first",
    name: "Proof first",
    description: "Leads with a result for a similar company, then follows up with the offer.",
    steps: [
      step(0, "{{subject_line}}", "Hi {{firstName}},\n\n{{personalized_first_line}}\n\nWe recently helped [similar company] [result with a number] in [timeframe].\n\nWould something similar be useful for {{companyName}}?\n\n{{sendingAccountFirstName}}"),
      step(3, "", "Hi {{firstName}},\n\nThe short version of how we did it: [two or three steps].\n\nHappy to walk you through it — here's my calendar if easier: {{calendarLink}}\n\n{{sendingAccountFirstName}}"),
      step(5, "", "Hi {{firstName}},\n\nLast note from me. If timing isn't right, no problem at all — just let me know if I should check back later in the year.\n\n{{sendingAccountFirstName}}"),
    ],
  },
  {
    id: "question-led",
    name: "Question led",
    description: "Opens with a relevant question to start a conversation rather than pitch.",
    steps: [
      step(0, "{{subject_line}}", "Hi {{firstName}},\n\n{{personalized_first_line}}\n\nQuick question: how are you currently handling [problem you solve] at {{companyName}}?\n\n{{sendingAccountFirstName}}"),
      step(3, "", "Hi {{firstName}},\n\nAsking because most [their role]s we speak to [common pain]. We help by [one-line offer].\n\nIs that on your radar at the moment?\n\n{{sendingAccountFirstName}}"),
      step(4, "", "Hi {{firstName}},\n\nI'll leave it here. If [problem] becomes a priority, I'd be glad to help.\n\n{{sendingAccountFirstName}}"),
    ],
  },
];

export interface SequenceIssue {
  level: "error" | "warning";
  /** 1-based step and variant (A, B, …); absent for whole-sequence issues. */
  step?: number;
  variant?: string;
  message: string;
}

export const variantLabel = (index: number) => String.fromCharCode(65 + index);

/** Problems that would make the sequence send wrong or broken emails. Errors block pushing to Instantly. */
export function checkSequence(steps: SequenceStep[], settings: ClientSettings, known: string[]): SequenceIssue[] {
  const issues: SequenceIssue[] = [];
  if (steps.length === 0) issues.push({ level: "error", message: "Add at least one step" });
  const knownLower = new Map(known.map((name) => [name.toLowerCase(), name]));

  steps.forEach((s, stepIndex) => {
    s.variants.forEach((variant, variantIndex) => {
      const at = { step: stepIndex + 1, variant: variantLabel(variantIndex) };
      if (stepIndex === 0 && !variant.subject.trim()) issues.push({ level: "error", ...at, message: "The first email needs a subject" });
      if (!variant.body.trim()) issues.push({ level: "error", ...at, message: "Body is empty" });
      const text = `${variant.subject}\n${variant.body}`;
      for (const name of templatePlaceholders(text)) {
        if (known.includes(name)) continue;
        const caseMatch = knownLower.get(name.toLowerCase());
        issues.push({
          level: "error",
          ...at,
          message: caseMatch ? `{{${name}}} should be {{${caseMatch}}}` : `Unknown variable {{${name}}}`,
        });
      }
      if (/\{\{[^}]*\|[^}]*\}\}/.test(text)) {
        issues.push({ level: "warning", ...at, message: "Fallbacks with | only work in custom variables; Instantly may send them as-is" });
      }
      if ((text.match(/\{\{/g) ?? []).length !== (text.match(/\}\}/g) ?? []).length) {
        issues.push({ level: "error", ...at, message: "Unbalanced {{ }}" });
      }
      if (/\[[^\]]+\]/.test(text)) issues.push({ level: "warning", ...at, message: "Still has [placeholder] text to replace" });
      if (/<[a-z][^>]*>/i.test(text)) issues.push({ level: "warning", ...at, message: "Write plain text; HTML tags are sent as text" });
      const lower = text.toLowerCase();
      for (const phrase of settings.copy.bannedPhrases) {
        if (phrase && lower.includes(phrase.toLowerCase())) issues.push({ level: "warning", ...at, message: `Uses banned phrase "${phrase}"` });
      }
    });
  });
  return issues;
}

/** Placeholder values as Instantly would see them for one lead. */
export function instantlyPreviewValues(lead: InstantlyLeadRequest, sender: { firstName?: string } = {}): Record<string, string> {
  return {
    ...lead.custom_variables,
    email: lead.email,
    ...(lead.first_name ? { firstName: lead.first_name } : {}),
    ...(lead.last_name ? { lastName: lead.last_name } : {}),
    ...(lead.company_name ? { companyName: lead.company_name } : {}),
    ...(lead.website ? { website: lead.website } : {}),
    ...(sender.firstName ? { sendingAccountFirstName: sender.firstName } : {}),
  };
}

export interface RenderedPart {
  text: string;
  /** Placeholder name for filled-in parts; absent for literal text. */
  variable?: string;
  missing?: boolean;
}

/** Splits a template into literal text and filled placeholders, so the preview can highlight them. */
export function renderParts(template: string, values: Record<string, string>): RenderedPart[] {
  const parts: RenderedPart[] = [];
  const pattern = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\|([^}]*))?\}\}/g;
  let last = 0;
  for (const match of template.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: template.slice(last, match.index) });
    const name = match[1]!;
    const value = renderTemplate(match[0], values);
    parts.push(value ? { text: value, variable: name } : { text: `{{${name}}}`, variable: name, missing: true });
    last = match.index + match[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

/** Plain text → the simple HTML Instantly's editor uses: one <div> per line, <br> for blank lines. */
export function textToInstantlyHtml(text: string): string {
  const escape = (line: string) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.trim() === "" ? "<div><br></div>" : `<div>${escape(line)}</div>`))
    .join("");
}

/** Body for POST /api/v2/campaigns (and the matching fields of PATCH /api/v2/campaigns/:id). */
export interface InstantlyCampaignRequest {
  name: string;
  campaign_schedule: {
    schedules: {
      name: string;
      timing: { from: string; to: string };
      days: Record<string, boolean>;
      timezone: string;
    }[];
  };
  sequences: { steps: { type: "email"; delay: number; delay_unit: "days"; variants: { subject: string; body: string }[] }[] }[];
  email_list?: string[];
  daily_limit?: number;
  stop_on_reply: boolean;
}

export function buildInstantlyCampaign(name: string, steps: SequenceStep[], setup: ClientSettings["campaignSetup"]): InstantlyCampaignRequest {
  const days = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((day) => [String(day), setup.days.includes(day)]));
  return {
    name,
    campaign_schedule: {
      schedules: [{ name: "Default", timing: { from: setup.from, to: setup.to }, days, timezone: setup.timezone }],
    },
    sequences: [
      {
        // Instantly's delay is the wait *after* a step before the next one; ours is the wait *before* a step.
        steps: steps.map((s, index) => ({
          type: "email",
          delay: steps[index + 1]?.waitDays ?? 0,
          delay_unit: "days",
          variants: s.variants.map((v) => ({ subject: v.subject, body: textToInstantlyHtml(v.body) })),
        })),
      },
    ],
    ...(setup.sendingAccounts.length > 0 ? { email_list: setup.sendingAccounts } : {}),
    ...(setup.dailyLimit ? { daily_limit: setup.dailyLimit } : {}),
    stop_on_reply: setup.stopOnReply,
  };
}
