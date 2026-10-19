import { describe, expect, it } from "vitest";
import { blocklistEntries, parseBlocklistPayload, parseSuppressionEntries } from "./suppression";

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

describe("parseBlocklistPayload", () => {
  it("reads flat form fields, whatever they are called", () => {
    expect(parseBlocklistPayload({ "Your Email*": " Jane@Acme.com ", Website: "https://www.acme.com/about" })).toEqual({
      email: "jane@acme.com",
      domain: "acme.com",
    });
    expect(parseBlocklistPayload({ work_email: "jane@acme.com" })).toEqual({ email: "jane@acme.com", domain: "acme.com" });
  });

  it("takes the invitee, not the host, from a Calendly-style booking", () => {
    const calendly = {
      event: "invitee.created",
      payload: {
        email: "invitee@prospect.io",
        cancel_url: "https://calendly.com/cancellations/x",
        scheduled_event: { event_memberships: [{ user_email: "sales@client.com" }] },
      },
    };
    expect(parseBlocklistPayload(calendly)).toEqual({ email: "invitee@prospect.io", domain: "prospect.io" });
  });

  it("skips the organiser in a Cal.com-style booking", () => {
    const cal = {
      triggerEvent: "BOOKING_CREATED",
      payload: { organizer: { email: "rep@client.com" }, attendees: [{ name: "Jo", email: "jo@buyer.co.uk" }] },
    };
    expect(parseBlocklistPayload(cal).email).toBe("jo@buyer.co.uk");
  });

  it("reads answers and label/value fields", () => {
    const typeform = { form_response: { answers: [{ type: "text", text: "hi" }, { type: "email", email: "a@b-corp.com" }] } };
    expect(parseBlocklistPayload(typeform).email).toBe("a@b-corp.com");
    const builder = { fields: [{ label: "Company website", value: "b-corp.com" }, { label: "Work email", value: "x@b-corp.com" }] };
    expect(parseBlocklistPayload(builder)).toEqual({ email: "x@b-corp.com", domain: "b-corp.com" });
    expect(parseBlocklistPayload({ email: { value: "v@corp.com" } }).email).toBe("v@corp.com");
  });

  it("does not treat the form page's url as the lead's website", () => {
    expect(parseBlocklistPayload({ email: "jane@gmail.com", url: "https://client.com/contact" })).toEqual({
      email: "jane@gmail.com",
      domain: "gmail.com",
    });
  });

  it("finds nothing in an unrelated payload", () => {
    expect(parseBlocklistPayload({ name: "Jane", email: "not an email" })).toEqual({ email: undefined, domain: undefined });
    expect(parseBlocklistPayload(null)).toEqual({ email: undefined, domain: undefined });
  });
});

describe("blocklistEntries", () => {
  const free = ["gmail.com"];

  it("blocks the email and the company by default", () => {
    expect(blocklistEntries({ email: "jane@acme.com", domain: "acme.com" }, "both", free)).toEqual([
      { kind: "email", value: "jane@acme.com" },
      { kind: "domain", value: "acme.com" },
    ]);
  });

  it("never blocks a free email provider as a company", () => {
    expect(blocklistEntries({ email: "jane@gmail.com", domain: "gmail.com" }, "both", free)).toEqual([{ kind: "email", value: "jane@gmail.com" }]);
    expect(blocklistEntries({ email: "jane@gmail.com", domain: "gmail.com" }, "domain", free)).toEqual([{ kind: "email", value: "jane@gmail.com" }]);
  });

  it("honours the scope", () => {
    expect(blocklistEntries({ email: "jane@acme.com", domain: "acme.com" }, "email", free)).toEqual([{ kind: "email", value: "jane@acme.com" }]);
    expect(blocklistEntries({ domain: "acme.com" }, "both", free)).toEqual([{ kind: "domain", value: "acme.com" }]);
    expect(blocklistEntries({}, "both", free)).toEqual([]);
  });
});
