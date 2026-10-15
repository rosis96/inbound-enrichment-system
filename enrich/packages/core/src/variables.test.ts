import { parseClientSettings, type AiVariable } from "@enrich/shared";
import { describe, expect, it } from "vitest";
import {
  buildPlan,
  buildWriterPrompt,
  crawlSections,
  generateVariables,
  LlmTransientError,
  passedValues,
  rejectedVariables,
  splitSentences,
  validateVariable,
  verifyPlan,
  type LlmJsonCall,
  type LlmJsonResult,
  type WriterContext,
} from "./variables";

const CRAWL = `## Related Companies
Source: https://www.related.com/
Related Companies is a global real estate and lifestyle company. We developed Hudson Yards, the largest private real estate development in the history of the United States.

## Our Portfolio
Source: https://www.related.com/our-portfolio
520 West 28th is a residential building designed by Zaha Hadid next to the High Line.`;

const settings = parseClientSettings({
  copy: {
    senderName: "Resonance",
    companyDescription: "Resonance is a place strategy consultancy.",
    services: ["Place strategy", "Research and market intelligence", "Brand strategy", "Destination marketing"],
    proof: ["Future of Luxury Travel study: affluent American travelers will spend more than $500 billion on leisure travel this year"],
    bannedPhrases: ["unmatched"],
  },
});

const context: WriterContext = {
  copy: settings.copy,
  contact: { firstName: "Priya", lastName: "Shah", title: "VP Marketing" },
  company: { domain: "related.com", name: "Related Companies", industry: "Real Estate", country: "US" },
  crawlText: CRAWL,
};

const planReply = {
  description: "A real estate development and investment company behind mixed-use, residential and commercial projects.",
  category: "mixed-use real estate developers",
  industry: "mixed-use real estate",
  activities: ["real estate development", "investment"],
  details: [
    { id: "D1", kind: "project", name: "Hudson Yards", detail: "Mixed-use district in Manhattan", evidence: "We developed Hudson Yards, the largest private real estate development", sourceUrl: "https://www.related.com/" },
    { id: "D2", kind: "project", name: "520 West 28th", detail: "Residential building by Zaha Hadid", evidence: "520 West 28th is a residential building", sourceUrl: "made-up" },
    { id: "D3", kind: "project", name: "Atlantis Towers", detail: "Invented", evidence: "not on the site", sourceUrl: null },
  ],
  primaryDetailId: "D3",
  alternativeDetailId: "D2",
  relevantServices: ["place strategy", "Brand Strategy", "Synergy consulting"],
  challenges: ["differentiation between competing developments", "stakeholder alignment"],
  benefits: ["stronger positioning", "clearer audience understanding"],
  longTermOutcomes: ["long-term asset value"],
  proof: ["Future of Luxury Travel study"],
  unknowns: ["marketing budget"],
};

const VALUE_PROP: AiVariable = {
  name: "value_proposition",
  instructions:
    "We specialize in scaling {{companycategory}} by {{what we do}} while solving challenges like {{2-3 challenges}}. And, I have seen how your {{specific project or achievement}} can be enhanced. Use exactly two sentences and a maximum of 85 words. Sentence two must start with 'And, I have seen'.",
  minWords: 5,
  maxWords: 25,
  examples: [],
};
const REFERENCE: AiVariable = {
  name: "reference",
  instructions: "Start with 'In my last email,' and continue the idea of {{value_proposition}} in one sentence.",
  minWords: 5,
  maxWords: 40,
  examples: [],
};

const GOOD_VP =
  "We specialize in scaling mixed-use real estate developers by combining place strategy and brand strategy while solving challenges like differentiation and stakeholder alignment. And, I have seen how your Hudson Yards development, which brings residential, commercial and cultural uses together, can be enhanced.";

const ok = (json: unknown): LlmJsonResult => ({ ok: true, json, model: "test-model", costUsd: 0.01 });

/** Replays canned replies in order and keeps the prompts it was sent. */
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

describe("crawlSections / splitSentences", () => {
  it("recovers page URLs from crawl text", () => {
    expect(crawlSections(CRAWL).map((s) => s.url)).toEqual(["https://www.related.com/", "https://www.related.com/our-portfolio"]);
  });

  it("counts sentences without splitting on abbreviations, initials or decimals", () => {
    expect(splitSentences("Dr. Smith grew 1.5x in the U.S. market. And, I have seen J. Doe's work!")).toHaveLength(2);
    expect(splitSentences("One.\n\nTwo? Three")).toEqual(["One.", "Two?", "Three"]);
  });
});

describe("verifyPlan", () => {
  it("keeps only details found on the website, with their real page, and services from the client's list", () => {
    const { plan, check } = verifyPlan(planReply, context)!;
    expect(plan.details.map((d) => [d.id, d.sourceUrl, d.verified])).toEqual([
      ["D1", "https://www.related.com/", true],
      ["D2", "https://www.related.com/our-portfolio", true],
    ]);
    expect(check.unverifiedDetails.map((d) => d.name)).toEqual(["Atlantis Towers"]);
    expect(plan.primaryDetailId).toBe("D1");
    expect(plan.alternativeDetailId).toBe("D2");
    expect(plan.relevantServices).toEqual(["Place strategy", "Brand strategy"]);
    expect(check.droppedServices).toEqual(["Synergy consulting"]);
    expect(plan.proof).toHaveLength(1);
  });

  it("falls back to a general plan when the planner fails, and throws on retryable errors", async () => {
    const failed = await buildPlan(context, fakeLlm([{ ok: false, code: "openai_400", transient: false }]));
    expect(failed.error).toBe("openai_400");
    expect(failed.plan.details).toEqual([]);
    await expect(buildPlan(context, fakeLlm([{ ok: false, code: "openai_429", transient: true }]))).rejects.toBeInstanceOf(LlmTransientError);
  });
});

describe("validateVariable", () => {
  const { plan } = verifyPlan(planReply, context)!;
  const check = (text: string, extra: Partial<{ detailIds: string[]; insufficientEvidence: string[] }> = {}) =>
    validateVariable({
      variable: VALUE_PROP,
      all: [VALUE_PROP],
      generated: { text, resolved: {}, detailIds: ["D1"], insufficientEvidence: [], ...extra },
      plan,
      context,
      results: {},
    });
  const failing = (text: string, extra = {}) => check(text, extra).filter((c) => c.status === "fail").map((c) => c.id);

  it("passes a well-formed, grounded value", () => {
    expect(failing(GOOD_VP)).toEqual([]);
  });

  it("fails structure, placeholders, invented figures and unverified details", () => {
    expect(failing("We specialize in scaling {{companycategory}} developers. Also Hudson Yards is great.")).toEqual(
      expect.arrayContaining(["placeholders", "brackets", "sentence-2"]),
    );
    expect(failing(`${GOOD_VP} It grew 40% last year.`)).toEqual(expect.arrayContaining(["sentences", "figures"]));
    expect(failing(GOOD_VP, { detailIds: ["D3"] })).toEqual(["evidence"]);
  });

  it("checks banned phrases, the visit, character limits, CTAs and required openings", () => {
    const line: AiVariable = {
      name: "product_complimentary",
      instructions: "Start with 'By the way,' and compliment one project. Under 30 words, no more than 120 characters. Do not include a CTA.",
      minWords: 3,
      maxWords: 60,
      examples: [],
    };
    const run = (text: string) =>
      validateVariable({ variable: line, all: [line], generated: { text, resolved: {}, detailIds: [], insufficientEvidence: [] }, plan, context, results: {} })
        .filter((c) => c.status === "fail")
        .map((c) => c.id);
    expect(run("By the way, 520 West 28th next to the High Line stands out.")).toEqual([]);
    expect(run("I noticed you visited our site; your unmatched Hudson Yards work is great. Are you free for a call?")).toEqual(
      expect.arrayContaining(["starts", "cta", "banned", "tracking"]),
    );
    expect(run(`By the way, ${"Hudson Yards is a remarkable place. ".repeat(4)}`)).toContain("chars");
  });

  it("allows figures from approved proof and warns about unsupported names", () => {
    const text = GOOD_VP.replace("can be enhanced.", "can be enhanced as affluent travelers spend $500 billion with Atlantis Towers.");
    const checks = check(text);
    expect(checks.find((c) => c.id === "figures")?.status).toBe("pass");
    expect(checks.find((c) => c.id === "names")).toMatchObject({ status: "warn", detail: expect.stringContaining("Atlantis Towers") });
  });
});

describe("generateVariables", () => {
  const { plan } = verifyPlan(planReply, context)!;
  const variables = [REFERENCE, VALUE_PROP];

  it("writes in dependency order, corrects a failed attempt and hands the finished value to dependents", async () => {
    const llm = fakeLlm([
      ok({ variables: { value_proposition: { text: "We help developers. It is good.", resolved: {}, detailIds: [] } } }),
      ok({ variables: { value_proposition: { text: GOOD_VP, resolved: { "{{companycategory}}": "mixed-use real estate developers" }, detailIds: ["D1"] } } }),
      ok({ variables: { reference: "In my last email, I mentioned how research-led positioning could strengthen Hudson Yards." } }),
    ]);
    const { results, calls, costUsd } = await generateVariables({ context, plan, variables }, llm);

    expect(calls).toBe(3);
    expect(costUsd).toBeCloseTo(0.03);
    expect(results.value_proposition).toMatchObject({ status: "ok", text: GOOD_VP, detailIds: ["D1"], sources: [{ url: "https://www.related.com/", label: "Hudson Yards" }] });
    expect(results.value_proposition!.attempts).toHaveLength(2);
    expect(results.value_proposition!.attempts[0]!.problems.join(" ")).toMatch(/Sentence 2 starts with/);
    expect(llm.prompts[1]).toContain("Your previous attempt failed these checks");
    expect(llm.prompts[2]).toContain(`- value_proposition: "${GOOD_VP}"`);
    expect(results.reference).toMatchObject({ status: "ok", dependsOn: ["value_proposition"] });
    expect(Object.keys(results)).toEqual(["reference", "value_proposition"]);
    expect(passedValues(results)).toHaveProperty("reference");
  });

  it("blocks dependents when a dependency never passes, and regenerates only what is asked", async () => {
    const bad = ok({ variables: { value_proposition: "Too short." } });
    const { results } = await generateVariables({ context, plan, variables, maxCorrections: 1 }, fakeLlm([bad, bad]));
    expect(results.value_proposition!.status).toBe("failed");
    expect(results.reference).toMatchObject({ status: "blocked" });

    const emptyFix = await generateVariables(
      { context, plan, variables: [VALUE_PROP], maxCorrections: 1 },
      fakeLlm([bad, ok({ variables: { value_proposition: "" } })]),
    );
    expect(emptyFix.results.value_proposition).toMatchObject({ status: "failed", text: "Too short." });
    expect(emptyFix.results.value_proposition!.attempts).toHaveLength(2);
    expect(Object.keys(rejectedVariables(results))).toEqual(["reference", "value_proposition"]);

    const again = await generateVariables(
      { context, plan, variables, only: ["value_proposition"], previous: results },
      fakeLlm([ok({ variables: { value_proposition: { text: GOOD_VP, detailIds: ["D1"] } } })]),
    );
    expect(again.calls).toBe(1);
    expect(again.results.value_proposition!.status).toBe("ok");
    expect(again.results.reference!.status).toBe("blocked");
  });

  it("shows the writer each placeholder's meaning and the research facts", () => {
    const prompt = buildWriterPrompt({
      context,
      plan,
      all: [VALUE_PROP, { ...REFERENCE, instructions: `${REFERENCE.instructions} Sign off {{accountSignature}} for {{firstName|there}}.` }],
      tasks: [{ variable: VALUE_PROP }],
      results: {},
    });
    expect(prompt).toContain("- {{companycategory}}: a description of what to write here");
    expect(prompt).toContain('sentence 2 starts with "And, I have seen"');
    expect(prompt).toContain("5-85 words");
    expect(prompt).toContain("[D1] (project) Hudson Yards");
    expect(prompt).not.toContain("Atlantis");
  });
});
