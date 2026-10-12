import { PayloadError, parseHappierleadsPayload } from "@enrich/core";
import { and, companies, contacts, eq, leads, rawEvents, sql } from "@enrich/db";
import { NormaliseJobData } from "@enrich/shared";
import type { JobContext } from "../context";
import { enqueue, recordStep } from "../pipeline";

export const schema = NormaliseJobData;

/** In ON DUPLICATE KEY UPDATE: prefer the new value, keep the stored one when the payload has none. */
const keep = (column: { name: string }) => sql.raw(`coalesce(values(\`${column.name}\`), \`${column.name}\`)`);

export async function handleNormalise(data: NormaliseJobData, ctx: JobContext): Promise<void> {
  const started = Date.now();
  const [event] = await ctx.db.select().from(rawEvents).where(eq(rawEvents.id, data.rawEventId));
  if (!event) {
    ctx.logger.warn("raw event not found, dropping");
    return;
  }

  const [existing] = await ctx.db
    .select({ id: leads.id, status: leads.status })
    .from(leads)
    .where(and(eq(leads.clientId, event.clientId), eq(leads.rawEventId, event.id)));
  if (existing && existing.status !== "received" && !data.force) {
    ctx.logger.info({ leadId: existing.id, status: existing.status }, "already normalised, skipping");
    return;
  }

  let visit;
  try {
    visit = parseHappierleadsPayload(event.payload);
  } catch (error) {
    if (!(error instanceof PayloadError)) throw error;
    // A bad payload never gets better on retry: record it and stop.
    await ctx.db.update(rawEvents).set({ error: error.message, processedAt: new Date() }).where(eq(rawEvents.id, event.id));
    ctx.logger.warn({ err: error.message }, "unparseable payload");
    return;
  }

  const leadId = await ctx.db.transaction(async (tx) => {
    await tx
      .insert(companies)
      .values({
        domain: visit.company.domain,
        name: visit.company.name ?? null,
        industry: visit.company.industry ?? null,
        employeeRange: visit.company.employeeRange ?? null,
        revenueRange: visit.company.revenueRange ?? null,
        country: visit.company.country ?? null,
        linkedinUrl: visit.company.linkedinUrl ?? null,
      })
      .onDuplicateKeyUpdate({
        set: {
          name: keep(companies.name),
          industry: keep(companies.industry),
          employeeRange: keep(companies.employeeRange),
          revenueRange: keep(companies.revenueRange),
          country: keep(companies.country),
          linkedinUrl: keep(companies.linkedinUrl),
          updatedAt: new Date(),
        },
      });
    const [company] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.domain, visit.company.domain));
    if (!company) throw new Error("company missing after upsert");

    const leadValues = {
      companyId: company.id,
      visitedAt: visit.visitedAt ?? event.receivedAt,
      pages: visit.pages,
      referrer: visit.referrer ?? null,
      session: visit.session,
      status: "normalised" as const,
      skipReason: null,
      icpScore: null,
      icpReasons: null,
      intentLevel: null,
      intentTopic: null,
    };
    await tx
      .insert(leads)
      .values({ clientId: event.clientId, rawEventId: event.id, ...leadValues })
      .onDuplicateKeyUpdate({ set: { ...leadValues, updatedAt: new Date() } });
    const [lead] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.clientId, event.clientId), eq(leads.rawEventId, event.id)));
    if (!lead) throw new Error("lead missing after upsert");

    // Rebuild contacts from the payload, keeping outreach state for emails already pushed.
    const previous = await tx.select().from(contacts).where(eq(contacts.leadId, lead.id));
    const previousByEmail = new Map(previous.filter((c) => c.email).map((c) => [c.email, c]));
    await tx.delete(contacts).where(eq(contacts.leadId, lead.id));
    if (visit.contacts.length > 0) {
      await tx.insert(contacts).values(
        visit.contacts.map((contact) => {
          const before = contact.email ? previousByEmail.get(contact.email) : undefined;
          return {
            leadId: lead.id,
            clientId: event.clientId,
            firstName: contact.firstName ?? null,
            lastName: contact.lastName ?? null,
            fullName: contact.fullName ?? null,
            title: contact.title ?? null,
            seniority: contact.seniority ?? null,
            linkedinUrl: contact.linkedinUrl ?? null,
            email: contact.email ?? null,
            emailSource: contact.email ? "happierleads" : null,
            instantlyLeadId: before?.instantlyLeadId ?? null,
            outreachStatus: before?.outreachStatus ?? "not_sent",
          };
        }),
      );
    }

    await tx.update(rawEvents).set({ processedAt: new Date(), error: null }).where(eq(rawEvents.id, event.id));
    return lead.id;
  });

  await recordStep(ctx, {
    leadId,
    step: "normalise",
    provider: "happierleads",
    status: "ok",
    input: { rawEventId: event.id, force: data.force ?? false },
    output: {
      company: visit.company,
      visitedAt: visit.visitedAt?.toISOString() ?? null,
      pages: visit.pages.length,
      contacts: visit.contacts.length,
      contactsWithEmail: visit.contacts.filter((c) => c.email).length,
    },
    durationMs: Date.now() - started,
  });
  await enqueue(ctx, "gates", { leadId, force: data.force });
}
