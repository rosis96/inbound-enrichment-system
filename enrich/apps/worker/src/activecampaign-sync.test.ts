import { describe, expect, it } from "vitest";
import { activeCampaignEntries } from "./activecampaign-sync";

const settings = { freeEmailDomains: ["gmail.com"], ownDomains: ["client.com"] };

describe("activeCampaignEntries", () => {
  it("blocks the email and its company, the email only for free mail, and skips the client's own people", () => {
    const entries = activeCampaignEntries(
      [
        {
          reason: "open_deal",
          contacts: [
            { email: "Jo@Acme.com", note: 'deal "Acme"' },
            { email: "sam@gmail.com", note: 'deal "Sam"' },
            { email: "rep@client.com", note: 'deal "Own"' },
            { email: "not an email", note: "x" },
          ],
        },
      ],
      settings,
    );
    expect(entries).toEqual([
      { kind: "email", value: "jo@acme.com", reason: "open_deal", note: 'deal "Acme"' },
      { kind: "domain", value: "acme.com", reason: "open_deal", note: 'deal "Acme"' },
      { kind: "email", value: "sam@gmail.com", reason: "open_deal", note: 'deal "Sam"' },
    ]);
  });

  it("keeps the first source's reason for a value found twice", () => {
    const entries = activeCampaignEntries(
      [
        { reason: "meeting_booked", contacts: [{ email: "jo@acme.com", note: "tag" }] },
        { reason: "open_deal", contacts: [{ email: "amy@acme.com", note: "deal" }] },
      ],
      settings,
    );
    expect(entries.find((e) => e.value === "acme.com")).toMatchObject({ reason: "meeting_booked", note: "tag" });
    expect(entries.find((e) => e.value === "amy@acme.com")).toMatchObject({ reason: "open_deal" });
  });
});
