import { clients, companies, eq, enrichmentSteps, leads, sendJob, type Database } from "@enrich/db";
import { queueName, type PipelineStep, type StepStatus } from "@enrich/shared";
import type { JobContext } from "./context";

/** Enqueues the next pipeline step for a lead. */
export async function enqueue(ctx: JobContext, step: PipelineStep, data: { leadId: string; force?: boolean }) {
  const jobId = await sendJob(ctx.db, queueName(step), data.force ? data : { leadId: data.leadId });
  ctx.logger.info({ next: step, nextJobId: jobId }, "enqueued next step");
}

export interface StepRecord {
  leadId: string;
  contactId?: string | null;
  step: PipelineStep;
  provider: string;
  status: StepStatus;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  durationMs?: number;
  costUsd?: number;
}

/** Appends one row to the enrichment_steps audit trail. */
export async function recordStep(ctx: JobContext, record: StepRecord): Promise<void> {
  await ctx.db.insert(enrichmentSteps).values({
    leadId: record.leadId,
    contactId: record.contactId ?? null,
    step: record.step,
    provider: record.provider,
    status: record.status,
    input: record.input ?? null,
    output: record.output ?? null,
    error: record.error ?? null,
    durationMs: record.durationMs ?? null,
    costUsd: record.costUsd ?? 0,
    attempt: ctx.attempt,
  });
}

/** Lead with its client and company, or undefined if the lead was deleted. */
export async function loadLead(db: Database, leadId: string) {
  const [row] = await db
    .select({ lead: leads, client: clients, company: companies })
    .from(leads)
    .innerJoin(clients, eq(leads.clientId, clients.id))
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .where(eq(leads.id, leadId));
  return row;
}
