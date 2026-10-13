import { describe, expect, it } from "vitest";
import { parseSuppressionEntries } from "./suppression";

describe("parseSuppressionEntries", () => {
  it("reads pasted lines and CSV cells into emails and domains", () => {
    const text = [
      "email,company,website",
      "Jane@Acme.com,Acme Ltd,https://www.acme.com/about",
      "competitor.io",
      "  www.Other-Agency.co.uk/ ; ceo@other-agency.co.uk",
      "not an email",
      "acme.com",
    ].join("\n");
    const { entries, skipped } = parseSuppressionEntries(text);
    expect(entries).toEqual([
      { kind: "email", value: "jane@acme.com" },
      { kind: "domain", value: "acme.com" },
      { kind: "domain", value: "competitor.io" },
      { kind: "domain", value: "other-agency.co.uk" },
      { kind: "email", value: "ceo@other-agency.co.uk" },
    ]);
    expect(skipped).toEqual(["Acme Ltd", "not an email"]);
  });
});
