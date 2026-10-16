import { knownPlaceholders, parseClientSettings } from "@enrich/shared";
import { describe, expect, it } from "vitest";
import {
  buildInstantlyCampaign,
  checkSequence,
  GENERIC_SEQUENCE_TEMPLATES,
  renderParts,
  SEQUENCE_TEMPLATES,
  textToInstantlyHtml,
} from "./sequence";

const settings = parseClientSettings({
  copy: { bannedPhrases: ["synergy"] },
  customVariables: [{ name: "calendarLink", value: "https://cal.com/x" }],
});
const known = knownPlaceholders(settings);
const steps = [
  { waitDays: 0, variants: [{ subject: "{{subject_line}}", body: "Hi {{firstName}},\n\n{{personalized_first_line}}" }] },
  { waitDays: 3, variants: [{ subject: "", body: "Bump & {{calendarLink}}" }, { subject: "", body: "Other <b>bump</b>" }] },
  { waitDays: 5, variants: [{ subject: "", body: "Bye" }] },
];

describe("checkSequence", () => {
  it("passes a valid sequence", () => {
    expect(checkSequence(steps.slice(0, 1), settings, known)).toEqual([]);
  });

  it("flags unknown variables, case mistakes, missing subject, HTML and banned phrases", () => {
    const issues = checkSequence(
      [
        { waitDays: 0, variants: [{ subject: "", body: "Hi {{firstname}} {{nope}} synergy" }] },
        { waitDays: 2, variants: [{ subject: "", body: "<p>x</p> [fill me]" }] },
      ],
      settings,
      known,
    );
    const messages = issues.map((i) => `${i.level}:${i.step}:${i.message}`);
    expect(messages).toEqual([
      "error:1:The first email needs a subject",
      "error:1:{{firstname}} should be {{firstName}}",
      "error:1:Unknown variable {{nope}}",
      'warning:1:Uses banned phrase "synergy"',
      "warning:2:Still has [placeholder] text to replace",
      "warning:2:Write plain text; HTML tags are sent as text",
    ]);
  });

  it("requires at least one step and every template only uses known or calendarLink variables", () => {
    expect(checkSequence([], settings, known)[0]?.level).toBe("error");
    for (const template of SEQUENCE_TEMPLATES) {
      expect(checkSequence(template.steps, settings, known).filter((i) => i.level === "error")).toEqual([]);
    }
  });
});

describe("buildInstantlyCampaign", () => {
  it("shifts waits onto the previous step, converts bodies to HTML and maps the schedule", () => {
    const body = buildInstantlyCampaign("Acme", steps, { ...settings.campaignSetup, sendingAccounts: ["sam@x.example"] });
    const built = body.sequences[0]!.steps;
    expect(built.map((s) => s.delay)).toEqual([3, 5, 0]);
    expect(built[1]!.variants).toHaveLength(2);
    expect(built[0]!.variants[0]!.body).toBe("<div>Hi {{firstName}},</div><div><br></div><div>{{personalized_first_line}}</div>");
    expect(built[1]!.variants[0]!.body).toBe("<div>Bump &amp; {{calendarLink}}</div>");
    expect(body.campaign_schedule.schedules[0]).toMatchObject({
      timing: { from: "09:00", to: "17:00" },
      days: { "0": false, "1": true, "5": true, "6": false },
      timezone: "America/Chicago",
    });
    expect(body.email_list).toEqual(["sam@x.example"]);
    expect(body.daily_limit).toBeUndefined();
  });

  it("escapes HTML in plain text", () => {
    expect(textToInstantlyHtml("a < b")).toBe("<div>a &lt; b</div>");
  });
});

describe("checkSequence for the generic campaign", () => {
  const withAiCustom = parseClientSettings({
    customVariables: [
      { name: "calendarLink", value: "https://cal.com/x" },
      { name: "opener", value: "{{personalized_first_line|Hope you are well}}" },
    ],
  });

  it("rejects AI variables and warns about custom variables built from them", () => {
    const issues = checkSequence(
      [{ waitDays: 0, variants: [{ subject: "{{subject_line}}", body: "Hi {{firstName}},\n\n{{opener}} {{calendarLink}}" }] }],
      withAiCustom,
      knownPlaceholders(withAiCustom),
      { generic: true },
    );
    expect(issues.map((i) => `${i.level}:${i.message}`)).toEqual([
      "error:{{subject_line}} is an AI variable; generic leads arrive without it",
      "warning:{{opener}} uses {{personalized_first_line}}, which generic leads don't have",
    ]);
  });

  it("allows AI variables in the personalised sequence", () => {
    expect(checkSequence(steps.slice(0, 1), withAiCustom, knownPlaceholders(withAiCustom))).toEqual([]);
  });

  it("ships starter templates without AI variables", () => {
    for (const template of GENERIC_SEQUENCE_TEMPLATES) {
      const errors = checkSequence(template.steps, settings, known, { generic: true }).filter((i) => i.level === "error");
      expect(errors, template.id).toEqual([]);
    }
  });
});

describe("renderParts", () => {
  it("marks filled and missing variables", () => {
    expect(renderParts("Hi {{firstName}}, {{x}}!", { firstName: "Priya" })).toEqual([
      { text: "Hi " },
      { text: "Priya", variable: "firstName" },
      { text: ", " },
      { text: "{{x}}", variable: "x", missing: true },
      { text: "!" },
    ]);
  });
});
