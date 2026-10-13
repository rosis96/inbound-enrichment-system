import { scoreIcp } from "@enrich/core";
import { and, contacts, eq, leads } from "@enrich/db";
import { LeadJobData, parseClientSettings } from "@enrich/shared";
import type { JobContext } from "../context";
import { enqueue, loadLead, recordStep } from "../pipeline";

export const schema = LeadJobData;

export async function handleIcp(data: LeadJobData, ctx: JobContext): Promise<void> {
  const started = Date.now();
  const row = await loadLead(ctx.db, data.leadId);
  if (!row) {
    ctx.logger.warn("lead not found, dropping");
    return;
  }
  const { lead, client, company } = row;
  const settings = parseClientSettings(client.settings);

  // Gates marked the eligible contacts as selected; ICP narrows that to the single best one.
  const eligible = await ctx.db
    .select({ id: contacts.id, title: contacts.title, seniority: contacts.seniority })
    .from(contacts)
    .where(and(eq(contacts.leadId, lead.id), eq(contacts.selected, true)));

  const result = scoreIcp({ company, pages: lead.pages, contacts: eligible, settings });
  const minScore = settings.icp.minScore;

  await ctx.db.transaction(async (tx) => {
    await tx.update(contacts).set({ selected: false }).where(eq(contacts.leadId, lead.id));
    if (result.contactId) await tx.update(contacts).set({ selected: true }).where(eq(contacts.id, result.contactId));
    await tx
      .update(leads)
      .set({
        icpScore: result.score,
        icpReasons: result.reasons,
        intentLevel: result.intent.level,
        intentTopic: result.intent.topic,
        ...(result.passed
          ? { status: "normalised" as const, skipReason: null }
          : { status: "below_icp" as const, skipReason: `icp score ${result.score} < ${minScore}` }),
      })
      .where(eq(leads.id, lead.id));
  });

  await recordStep(ctx, {
    leadId: lead.id,
    contactId: result.contactId,
    step: "icp",
    provider: "internal",
    status: result.passed ? "ok" : "skipped",
    input: { minScore, eligibleContacts: eligible.length },
    output: result,
    durationMs: Date.now() - started,
  });

  if (result.passed) await enqueue(ctx, "research", data);
  else ctx.logger.info({ score: result.score, minScore }, "below ICP threshold");
}
