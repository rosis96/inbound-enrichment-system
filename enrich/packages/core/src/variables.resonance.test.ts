// End-to-end behaviour of descriptive placeholders with Resonance's value proposition, using a fake
// LLM: what the writer is told, how its output is checked, and what happens when it invents things.
import { parseClientSettings, parsePlaceholders, type AiVariable } from "@enrich/shared";
import { describe, expect, it } from "vitest";
import {
  buildWriterPrompt,
  generateVariables,
  validateVariable,
  verifyPlan,
  type LlmJsonCall,
  type LlmJsonResult,
  type WriterContext,
} from "./variables";

// Shaped like the real related.com crawl (homepage and properties page).
const CRAWL = `## Related Companies | Global Real Estate Development
Source: https://www.related.com/
We are Related Companies. Celebrating the communities who inspire and uplift us every day.
Related Midwest breaks ground on affordable community The Adeline in Ann Arbor, MI.

## Properties | Related
Source: https://www.related.com/our-company/properties
With over 50 years of experience and a real estate portfolio valued at more than $60 billion, Related Companies offer properties in gateway cities.
The Grand LA. The centerpiece of a plan to reinvigorate downtown Los Angeles, The Grand LA is designed by Frank Gehry.
Brent Cross Town, a major regeneration scheme that will provide thousands of new jobs and homes, is a mixed-use project in development.`;

const RESONANCE = parseClientSettings({
  copy: {
    senderName: "Resonance",
    companyDescription: "Resonance is a place strategy consultancy for destinations, cities and developments.",
    offer: "a free diagnostic of how their project is perceived against competitors",
    services: ["Place strategy", "Research and market intelligence", "Destination positioning", "Brand strategy", "Stakeholder alignment"],
    proof: [
      "Future of Luxury Travel study: affluent American travelers (the top 10%) will spend more than $500 billion on leisure travel this year",
      "East Village, Calgary: place brand and development strategy",
    ],
    bannedPhrases: ["unmatched", "guarantee"],
  },
});

const context: WriterContext = {
  copy: RESONANCE.copy,
  contact: { firstName: "Priya", lastName: "Shah", title: "VP Marketing" },
  // "Real Estate" is the raw Happierleads industry; {{industry}} must not just become this.
  company: { domain: "related.com", name: "Related Companies", industry: "Real Estate", country: "US" },
  crawlText: CRAWL,
};

const { plan } = verifyPlan(
  {
    description: "A real estate development and investment company behind mixed-use, residential and affordable projects.",
    category: "mixed-use real estate developers",
    industry: "mixed-use real estate",
    activities: ["real estate development", "affordable housing"],
    details: [
      { id: "D1", kind: "project", name: "The Grand LA", detail: "Frank Gehry-designed centerpiece of downtown LA's revitalisation", evidence: "The Grand LA is designed by Frank Gehry" },
      { id: "D2", kind: "project", name: "Brent Cross Town", detail: "Mixed-use regeneration scheme in London", evidence: "a major regeneration scheme that will provide thousands of new jobs and homes" },
      { id: "D3", kind: "project", name: "Hudson Yards", detail: "Not in the crawled text", evidence: "Hudson Yards is the largest private development" },
    ],
    relevantServices: ["Place strategy", "Brand strategy", "Destination positioning"],
    challenges: ["differentiation between competing developments", "stakeholder alignment"],
    benefits: ["clearer differentiation", "stronger tenant appeal", "better visitor engagement"],
    longTermOutcomes: ["lasting asset value"],
    proof: ["East Village, Calgary: place brand and development strategy"],
    unknowns: ["marketing budget", "buying intent"],
  },
  context,
)!;

// The value proposition as a user would paste it, with seven descriptive placeholders.
const VALUE_PROPOSITION: AiVariable = {
  name: "value_proposition",
  instructions: `We specialize in scaling {{companycategory}} by {{what we do}} to help them {{desired outcome}} while solving challenges like {{2-3 challenges}}.

And, I have seen how your {{specific named project and why it matters}}, which can be enhanced through {{relevant services}} to achieve {{3-4 benefits}} and {{long-term strategic outcome}}.

Use exactly two sentences and a maximum of 85 words. Sentence two must start with 'And, I have seen'.`,
  minWords: 5,
  maxWords: 25,
  examples: [],
};

const GOOD =
  "We specialize in scaling mixed-use real estate developers by combining place strategy, research and brand strategy to help them strengthen their market position while solving challenges like differentiation and stakeholder alignment.\n\n" +
  "And, I have seen how your Grand LA development, designed by Frank Gehry as the centerpiece of a plan to reinvigorate downtown Los Angeles, which can be enhanced through destination positioning and brand strategy to achieve clearer differentiation, stronger tenant appeal and better visitor engagement and lasting asset value.";

const GOOD_RESOLVED = {
  "{{companycategory}}": "mixed-use real estate developers",
  "{{what we do}}": "combining place strategy, research and brand strategy",
  "{{desired outcome}}": "strengthen their market position",
  "{{2-3 challenges}}": "differentiation and stakeholder alignment",
  "{{specific named project and why it matters}}": "Grand LA development, designed by Frank Gehry as the centerpiece of a plan to reinvigorate downtown Los Angeles",
  "{{relevant services}}": "destination positioning and brand strategy",
  "{{3-4 benefits}}": "clearer differentiation, stronger tenant appeal and better visitor engagement",
  "{{long-term strategic outcome}}": "lasting asset value",
};

const ok = (json: unknown): LlmJsonResult => ({ ok: true, json, model: "test", costUsd: 0 });
function fakeLlm(replies: LlmJsonResult[]): LlmJsonCall & { prompts: string[] } {
  const prompts: string[] = [];
  const call = (async (prompt: string) => {
    prompts.push(prompt);
    const next = replies.shift();
    if (!next) throw new Error("no more fake replies");
    return next;
  }) as LlmJsonCall & { prompts: string[] };
  call.prompts = prompts;
  return call;
}

const check = (variable: AiVariable, text: string, extra: Partial<{ resolved: Record<string, string>; detailIds: string[]; insufficientEvidence: string[] }> = {}) =>
  validateVariable({
    variable,
    all: [variable],
    generated: { text, resolved: GOOD_RESOLVED, detailIds: ["D1"], insufficientEvidence: [], ...extra },
    plan,
    context,
    results: {},
  });
const failing = (variable: AiVariable, text: string, extra = {}) => check(variable, text, extra).filter((c) => c.status === "fail").map((c) => c.id);

describe("what the writer receives for descriptive placeholders", () => {
  const prompt = buildWriterPrompt({ context, plan, all: [VALUE_PROPOSITION], tasks: [{ variable: VALUE_PROPOSITION }], results: {} });

  it("gets the full instructions verbatim", () => {
    expect(prompt).toContain(VALUE_PROPOSITION.instructions);
  });

  it("gets every placeholder as something to write, not a value looked up from lead data", () => {
    for (const raw of Object.keys(GOOD_RESOLVED)) {
      expect(prompt).toContain(`- ${raw}: a description of what to write here; resolve it from the research plan and the sender's context`);
    }
  });

  it("gets the verified research facts with their source pages, and not the unverified one", () => {
    expect(prompt).toContain("Category for outreach: mixed-use real estate developers");
    expect(prompt).toContain("[D1] (project) The Grand LA");
    expect(prompt).toContain("Source: https://www.related.com/our-company/properties");
    expect(prompt).toContain("[D2] (project) Brent Cross Town");
    expect(prompt).not.toContain("Hudson Yards");
    expect(prompt).toContain("Possible challenges: differentiation between competing developments; stakeholder alignment");
    expect(prompt).toContain("Unknown (never claim): marketing budget; buying intent");
  });

  it("gets the client's saved services, approved proof and description", () => {
    for (const service of RESONANCE.copy.services) expect(prompt).toContain(`- ${service}`);
    for (const item of RESONANCE.copy.proof) expect(prompt).toContain(`- ${item}`);
    expect(prompt).toContain(RESONANCE.copy.companyDescription);
  });

  it("gets the rules it will be checked against", () => {
    expect(prompt).toContain("exactly 2 sentences");
    expect(prompt).toContain('sentence 2 starts with "And, I have seen"');
    expect(prompt).toContain("5-85 words");
  });

  it("treats {{industry}} as the AI's broader industry, not the raw Happierleads field", () => {
    const withIndustry = { ...VALUE_PROPOSITION, instructions: "Name their {{industry}} and {{companycategory}} in one sentence." };
    const p = buildWriterPrompt({ context, plan, all: [withIndustry], tasks: [{ variable: withIndustry }], results: {} });
    expect(p).toContain("- {{industry}}: a description of what to write here");
    expect(p).not.toContain('{{industry}}: use "Real Estate"');
  });
});

describe("new descriptive placeholders need no code", () => {
  it("parses any wording as an AI instruction and accepts a grounded resolution", () => {
    const custom: AiVariable = {
      name: "proof_line",
      instructions: "Write one sentence: {{mention a named project that demonstrates their expertise}} shows why {{what we can do for them}} matters.",
      minWords: 5,
      maxWords: 40,
      examples: [],
    };
    expect(parsePlaceholders(custom.instructions).map((p) => p.kind)).toEqual(["dynamic", "dynamic"]);
    const prompt = buildWriterPrompt({ context, plan, all: [custom], tasks: [{ variable: custom }], results: {} });
    expect(prompt).toContain("- {{mention a named project that demonstrates their expertise}}: a description of what to write here");
    expect(
      failing(custom, "Brent Cross Town, a regeneration scheme bringing new jobs and homes, shows why research-led place strategy matters.", {
        resolved: {
          "{{mention a named project that demonstrates their expertise}}": "Brent Cross Town, a regeneration scheme bringing new jobs and homes",
          "{{what we can do for them}}": "research-led place strategy",
        },
        detailIds: ["D2"],
      }),
    ).toEqual([]);
  });
});

describe("multiple placeholders in one instruction", () => {
  it("passes when all seven are resolved inside the template's own wording", () => {
    const checks = check(VALUE_PROPOSITION, GOOD);
    expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
    expect(checks.map((c) => c.id)).toEqual(expect.arrayContaining(["placeholders", "resolution", "wording", "sentences", "sentence-2", "words", "evidence"]));
  });

  it("fails when any placeholder is left in the output", () => {
    expect(failing(VALUE_PROPOSITION, GOOD.replace("clearer differentiation, stronger tenant appeal and better visitor engagement", "{{3-4 benefits}}"))).toEqual(
      expect.arrayContaining(["placeholders", "brackets"]),
    );
  });

  it("warns when the writer does not report what it used for a placeholder", () => {
    const { "{{3-4 benefits}}": _, ...partial } = GOOD_RESOLVED;
    expect(check(VALUE_PROPOSITION, GOOD, { resolved: partial }).find((c) => c.id === "resolution")).toMatchObject({
      status: "warn",
      detail: expect.stringContaining("{{3-4 benefits}}"),
    });
  });

  it("fails when the template's own wording or sentence structure is changed", () => {
    expect(failing(VALUE_PROPOSITION, GOOD.replace("while solving challenges like", "and tackling issues such as"))).toEqual(["wording"]);
    expect(failing(VALUE_PROPOSITION, GOOD.replace("And, I have seen how your", "Your"))).toEqual(expect.arrayContaining(["wording", "sentence-2"]));
    expect(failing(VALUE_PROPOSITION, GOOD.replace("alignment.\n\nAnd,", "alignment, and,"))).toEqual(expect.arrayContaining(["sentences"]));
  });
});

describe("lead merge fields and dependent variables are handled apart from descriptive placeholders", () => {
  const reference: AiVariable = {
    name: "reference",
    instructions:
      "Start with 'In my last email,' and greet {{firstName|there}} at {{companyName|your team}}, continue the exact idea of {{value_proposition}} and add {{one new benefit for their company category}}. Sign off with {{accountSignature}}.",
    minWords: 5,
    maxWords: 60,
    examples: [],
  };
  const all = [VALUE_PROPOSITION, reference];

  it("classifies each kind", () => {
    expect(parsePlaceholders(reference.instructions, ["value_proposition"]).map((p) => [p.key, p.kind])).toEqual([
      ["firstName", "data"],
      ["companyName", "data"],
      ["value_proposition", "variable"],
      ["one new benefit for their company category", "dynamic"],
      ["accountSignature", "data"],
    ]);
  });

  it("fills lead data from the lead, keeps mail-merge tokens and hands over the finished variable", async () => {
    const llm = fakeLlm([
      ok({ variables: { value_proposition: { text: GOOD, resolved: GOOD_RESOLVED, detailIds: ["D1"] } } }),
      ok({
        variables: {
          reference: {
            text: "In my last email, Priya, I shared how place strategy could set The Grand LA apart at Related Companies, and it can also build stakeholder alignment. {{accountSignature}}",
            resolved: { "{{one new benefit for their company category}}": "build stakeholder alignment" },
            detailIds: ["D1"],
          },
        },
      }),
    ]);
    const { results } = await generateVariables({ context, plan, variables: all }, llm);

    expect(llm.prompts[1]).toContain('- {{firstName|there}}: use "Priya"');
    expect(llm.prompts[1]).toContain('- {{companyName|your team}}: use "Related Companies"');
    expect(llm.prompts[1]).toContain("- {{accountSignature}}: keep exactly as {{accountSignature}} (filled when the email is sent)");
    expect(llm.prompts[1]).toContain(`- value_proposition: "${GOOD}"`);
    expect(llm.prompts[0]).not.toContain("### reference");
    expect(results.value_proposition!.status).toBe("ok");
    expect(results.reference).toMatchObject({ status: "ok", dependsOn: ["value_proposition"] });
    expect(results.reference!.checks.find((c) => c.id === "placeholders")!.status).toBe("pass");
  });

  it("uses the fallback when the lead has no value for a merge field", () => {
    const anonymous = { ...context, contact: { firstName: null, lastName: null, title: null } };
    const prompt = buildWriterPrompt({ context: anonymous, plan, all, tasks: [{ variable: reference }], results: {} });
    expect(prompt).toContain('- {{firstName|there}}: use "there"');
  });
});

describe("unverified claims are never accepted to fill a placeholder", () => {
  it("fails a project that the website does not mention, and invented results", () => {
    const hudson = GOOD.replace("Grand LA development, designed by Frank Gehry as the centerpiece of a plan to reinvigorate downtown Los Angeles", "Hudson Yards");
    expect(failing(VALUE_PROPOSITION, hudson, { detailIds: ["D3"] })).toEqual(["evidence"]);
    expect(check(VALUE_PROPOSITION, hudson, { detailIds: [] }).find((c) => c.id === "names")).toMatchObject({ status: "warn" });
    expect(failing(VALUE_PROPOSITION, GOOD.replace("lasting asset value", "a 35% rise in occupancy"))).toEqual(["figures"]);
    expect(failing(VALUE_PROPOSITION, GOOD.replace("lasting asset value", "the $60 billion portfolio's value"))).toEqual([]);
  });

  it("asks for a correction with the same research instead of keeping an invented figure", async () => {
    const invented = GOOD.replace("lasting asset value", "a 35% rise in occupancy");
    const llm = fakeLlm([
      ok({ variables: { value_proposition: { text: invented, resolved: GOOD_RESOLVED, detailIds: ["D1"] } } }),
      ok({ variables: { value_proposition: { text: GOOD, resolved: GOOD_RESOLVED, detailIds: ["D1"] } } }),
    ]);
    const { results } = await generateVariables({ context, plan, variables: [VALUE_PROPOSITION] }, llm);
    expect(results.value_proposition).toMatchObject({ status: "ok", text: GOOD });
    expect(llm.prompts[1]).toContain("No invented figures: not in the research or approved proof: 35");
    expect(llm.prompts[1]).toContain("Use the same research; do not add new facts.");
  });

  it("flags a placeholder that needed a specific detail the research could not support", () => {
    const noResearch = verifyPlan({ category: "real estate developers", details: [] }, { ...context, crawlText: null })!.plan;
    const checks = validateVariable({
      variable: VALUE_PROPOSITION,
      all: [VALUE_PROPOSITION],
      generated: {
        text: GOOD.replace("Grand LA development, designed by Frank Gehry as the centerpiece of a plan to reinvigorate downtown Los Angeles", "development portfolio"),
        resolved: GOOD_RESOLVED,
        detailIds: [],
        insufficientEvidence: ["{{specific named project and why it matters}}"],
      },
      plan: noResearch,
      context: { ...context, crawlText: null },
      results: {},
    });
    expect(checks.find((c) => c.id === "personalisation")).toMatchObject({ status: "warn", detail: expect.stringContaining("insufficient evidence") });
  });
});
