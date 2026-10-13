"use server";

import { clients, eq, getDb, leads, rawEvents } from "@enrich/db";
import { TEST_PAYLOAD_KEY, type TestLeadFlags } from "@enrich/shared";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { enqueueNormalise } from "@/lib/queue";

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim() || undefined;

/** "https://www.Acme.com/about" → "acme.com"; empty if it does not look like a domain. */
function toDomain(value: string): string {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0]!;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : "";
}

/** Builds a Happierleads-shaped payload from the form and runs it through the normal pipeline. */
export async function sendTestLead(formData: FormData): Promise<void> {
  await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "");
  const domain = toDomain(String(formData.get("website") ?? ""));
  const fail = (message: string): never => redirect(`/test-lead?client=${clientId}&error=${encodeURIComponent(message)}`);
  if (!domain) fail("Enter a website such as acme.com");

  const db = getDb();
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
  if (!client) redirect(`/test-lead?error=${encodeURIComponent("Pick a client")}`);

  const site = `https://${domain}`;
  const pages = String(formData.get("pages") ?? "")
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((path, i) => ({
      url: path.startsWith("http") ? path : `${site}${path.startsWith("/") ? "" : "/"}${path}`,
      title: path,
      timestamp: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
    }));
  const flags: TestLeadFlags = {
    dryRun: formData.get("dryRun") === "on",
    skipDedupe: formData.get("skipDedupe") === "on",
    freshResearch: formData.get("freshResearch") === "on",
  };
  const email = text(formData, "email");

  const payload = {
    event: "company.identified",
    createdAt: new Date().toISOString(),
    company: {
      name: text(formData, "companyName"),
      domain: site,
      industry: text(formData, "industry"),
      employees: text(formData, "employees"),
      revenue: text(formData, "revenue"),
      location: { country: text(formData, "country"), city: text(formData, "city") },
      linkedin: text(formData, "companyLinkedin"),
    },
    session: { referrer: "test-lead", duration: 120, pages },
    contacts: email || text(formData, "firstName")
      ? [
          {
            firstName: text(formData, "firstName"),
            lastName: text(formData, "lastName"),
            position: text(formData, "title"),
            email,
            linkedin: text(formData, "contactLinkedin"),
          },
        ]
      : [],
    [TEST_PAYLOAD_KEY]: flags,
  };

  const rawEventId = randomUUID();
  await db.insert(rawEvents).values({ id: rawEventId, clientId: client.id, source: "happierleads", payload });
  await enqueueNormalise({ rawEventId });

  // The worker creates the lead within a second or two; open it as soon as it exists.
  for (let i = 0; i < 16; i++) {
    const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.rawEventId, rawEventId));
    if (lead) redirect(`/leads/${lead.id}?test=1`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  redirect(`/events?client=${client.id}`);
}
