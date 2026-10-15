import { describe, expect, it } from "vitest";
import { parseClientSettings } from "./settings";
import {
  dependencyOrder,
  effectiveRules,
  parsePlaceholders,
  rulesFromInstructions,
  suggestedDependencies,
  variableDependencies,
  withDependencies,
  withDependents,
} from "./variable-template";

const VALUE_PROP = `We specialize in scaling {{companycategory}} by {{what we do}} to help them {{desired outcome}} while solving challenges like {{2-3 challenges}}.

And, I have seen how your {{specific named project and why it matters}}, which can be enhanced through {{relevant services}} to achieve {{3-4 benefits}} and {{long-term strategic outcome}}.

Use exactly two sentences and a maximum of 85 words. Sentence two must start with 'And, I have seen'.`;

describe("parsePlaceholders", () => {
  it("tells data fields, other variables and free-text instructions apart", () => {
    const found = parsePlaceholders("Hi {{ firstName|there }}, {{value_proposition}} {{2-3 challenges}} {{companyName}} {{accountSignature}} {{firstName|there}}", [
      "value_proposition",
    ]);
    expect(found.map((p) => [p.key, p.kind, p.ref])).toEqual([
      ["firstName", "data", "firstName"],
      ["value_proposition", "variable", "value_proposition"],
      ["2-3 challenges", "dynamic", undefined],
      ["companyName", "data", "companyName"],
      ["accountSignature", "data", "accountSignature"],
      ["firstName", "data", "firstName"],
    ]);
    expect(found[0]!.fallback).toBe("there");
    expect(found[4]!.mailMerge).toBe(true);
  });

  it("treats industry and category as dynamic, not as the raw visitor-data field", () => {
    expect(parsePlaceholders("{{industry}} {{companycategory}}").map((p) => p.kind)).toEqual(["dynamic", "dynamic"]);
  });
});

describe("rulesFromInstructions", () => {
  it("reads sentence count, word limit and the opening of a given sentence", () => {
    expect(rulesFromInstructions(VALUE_PROP)).toEqual({
      sentences: 2,
      maxWords: 85,
      sentenceStarts: [{ sentence: 2, text: "And, I have seen" }],
      noCta: false,
    });
  });

  it("reads openings, strict limits, ranges, characters and CTA bans", () => {
    expect(rulesFromInstructions("Start the complimentary line with 'By the way,'. Keep it under 40 words. Do not include a CTA.")).toMatchObject({
      startsWith: ["By the way,"],
      maxWords: 39,
      noCta: true,
    });
    expect(rulesFromInstructions(`Begin with "In my last email," and write 20-30 words, no more than 200 characters.`)).toMatchObject({
      startsWith: ["In my last email,"],
      minWords: 20,
      maxWords: 30,
      maxChars: 200,
    });
    expect(rulesFromInstructions("Start with 'And, I've seen how' then continue.").startsWith).toEqual(["And, I've seen how"]);
    expect(rulesFromInstructions("Write in one sentence.").sentences).toBe(1);
  });

  it("accepts every alternative opening, not just the first", () => {
    expect(rulesFromInstructions("Never claim results. Start with 'We recently' or 'Our work with'. Never present the prospect as a client.").startsWith).toEqual([
      "We recently",
      "Our work with",
    ]);
    expect(rulesFromInstructions(`Begin with "Hi", "Hello" or "Hey" and keep it short.`).startsWith).toEqual(["Hi", "Hello", "Hey"]);
  });
});

describe("effectiveRules", () => {
  it("lets instruction limits win over the default word fields", () => {
    const rules = effectiveRules({ name: "v", instructions: VALUE_PROP, minWords: 5, maxWords: 25 });
    expect(rules).toMatchObject({ minWords: 5, maxWords: 85, sentences: 2, from: { maxWords: "instructions", sentences: "instructions" } });
  });

  it("lets the explicit sentence and opening fields win over the instructions", () => {
    const rules = effectiveRules({ name: "v", instructions: "Write exactly two sentences.", minWords: 1, maxWords: 50, sentences: 3, startsWith: "So," });
    expect(rules).toMatchObject({ sentences: 3, startsWith: ["So,"], from: { sentences: "field", startsWith: "field" } });
  });
});

describe("dependencies", () => {
  const vars = [
    { name: "reference", instructions: "Start with 'In my last email,' and continue {{value_proposition}}." },
    { name: "value_proposition", instructions: VALUE_PROP },
    { name: "product_complimentary", instructions: "By the way, mention another project than in value_proposition.", dependsOn: [] },
  ];

  it("orders variables in layers from explicit and referenced dependencies", () => {
    expect(variableDependencies(vars[0]!, vars)).toEqual(["value_proposition"]);
    expect(dependencyOrder(vars)).toEqual({ ok: true, layers: [["value_proposition", "product_complimentary"], ["reference"]] });
    expect(withDependents(["value_proposition"], vars)).toEqual(["reference", "value_proposition"]);
    expect(withDependencies(["reference"], vars)).toEqual(["reference", "value_proposition"]);
    expect(withDependencies(["product_complimentary"], vars)).toEqual(["product_complimentary"]);
  });

  it("suggests plain-text mentions without adding them", () => {
    expect(suggestedDependencies(vars[2]!, vars)).toEqual(["value_proposition"]);
    expect(suggestedDependencies(vars[0]!, vars)).toEqual([]);
  });

  it("detects cycles, and settings validation rejects them", () => {
    const cyclic = [
      { name: "a", instructions: "{{b}}" },
      { name: "b", instructions: "x", dependsOn: ["a"] },
    ];
    expect(dependencyOrder(cyclic)).toEqual({ ok: false, cycle: ["a", "b", "a"] });
    expect(() => parseClientSettings({ aiVariables: cyclic })).toThrow(/circular dependency: a → b → a/);
    expect(() => parseClientSettings({ aiVariables: [{ name: "a", instructions: "x", dependsOn: ["nope"] }] })).toThrow(/unknown variable/);
  });
});
