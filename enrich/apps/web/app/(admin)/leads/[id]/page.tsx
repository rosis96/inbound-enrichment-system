import { asc, clients, companies, contacts, eq, enrichmentSteps, getDb, leads, rawEvents } from "@enrich/db";
import { getEnv } from "@enrich/shared/env";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { Alert, Card, DescriptionList, formatDateTime, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { reprocessLead } from "./actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STEP_DOT = { ok: "bg-emerald-500", skipped: "bg-slate-300", failed: "bg-red-500" } as const;

function Json({ value }: { value: unknown }) {
  return <pre className="pre">{JSON.stringify(value, null, 2)}</pre>;
}

function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-200">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        {title}
        <Icon name="arrowRight" className="size-4 text-slate-400 transition group-open:rotate-90" />
      </summary>
      <div className="border-t border-slate-200 p-3">{children}</div>
    </details>
  );
}

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reprocessed?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { reprocessed } = await searchParams;
  if (!UUID.test(id)) notFound();
  const db = getDb();

  const [row] = await db
    .select({ lead: leads, company: companies, client: clients, rawEvent: rawEvents })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .innerJoin(clients, eq(leads.clientId, clients.id))
    .innerJoin(rawEvents, eq(leads.rawEventId, rawEvents.id))
    .where(eq(leads.id, id));
  if (!row) notFound();
  const { lead, company, client, rawEvent } = row;

  const [leadContacts, steps] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.leadId, id)).orderBy(asc(contacts.createdAt)),
    db.select().from(enrichmentSteps).where(eq(enrichmentSteps.leadId, id)).orderBy(asc(enrichmentSteps.createdAt)),
  ]);
  const pushSteps = steps.filter((step) => step.step === "push");
  const lastPersonalise = [...steps].reverse().find((step) => step.step === "personalise");
  const selected = leadContacts.find((contact) => contact.selected);
  const lastGates = [...steps].reverse().find((step) => step.step === "gates");
  const dryRun = getEnv().GLOBAL_DRY_RUN || client.dryRun;
  const score = lead.icpScore;

  return (
    <>
      <PageHeader
        back={
          <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
            <Icon name="arrowLeft" className="size-4" /> Leads
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {company.name ?? company.domain}
            <StatusBadge status={lead.status} />
          </span>
        }
        description={`${company.domain} · ${client.name} · received ${formatDateTime(lead.createdAt)}`}
        actions={
          <form action={reprocessLead}>
            <input type="hidden" name="leadId" value={lead.id} />
            <button type="submit" className="btn-primary">
              <Icon name="refresh" className="size-4" /> Reprocess
            </button>
          </form>
        }
      />

      <div className="space-y-6">
        {reprocessed && (
          <Alert tone="info">
            Reprocessing queued. The worker re-runs normalise → gates → ICP → personalise → push; refresh in a few seconds.
          </Alert>
        )}
        {lead.skipReason && <Alert tone={lead.status === "failed" ? "error" : "warning"}>{lead.skipReason}</Alert>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-500">ICP score</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{score ?? "–"}</div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${score ?? 0}%` }} />
            </div>
          </div>
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-500">Intent</div>
            <div className="mt-2 text-3xl font-semibold capitalize">{lead.intentLevel ?? "–"}</div>
            <div className="mt-1 text-sm text-slate-500">{lead.intentTopic ?? "No topic"}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-500">Sending</div>
            <div className="mt-2 flex items-center gap-2 text-3xl font-semibold">
              <span className={`size-2.5 rounded-full ${dryRun ? "bg-amber-400" : "bg-emerald-500"}`} />
              {dryRun ? "Dry run" : "Live"}
            </div>
            <div className="mt-1 truncate text-sm text-slate-500">
              {lead.campaignId ? `Campaign ${lead.campaignId}` : "No campaign yet"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="min-w-0 space-y-6 xl:col-span-2">
            <Card title="Email personalisation" description="Sent to Instantly as {{subjectLine}} and {{firstLine}}.">
              {selected?.firstLine ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-3 text-sm">
                    <Icon name="mail" className="size-4 text-slate-400" />
                    <span className="text-slate-500">To</span>
                    <span className="truncate text-slate-900">{selected.email}</span>
                  </div>
                  <div className="pt-3 text-sm font-semibold text-slate-900">{selected.subjectLine}</div>
                  <p className="mt-2 text-sm text-slate-700">{selected.firstLine}</p>
                  {selected.personalisationMeta && (
                    <p className="mt-3 text-xs text-slate-500">
                      {selected.personalisationMeta.model} · prompt v{selected.personalisationMeta.promptVersion}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No first line{lastPersonalise?.error ? `: ${lastPersonalise.error}` : lastPersonalise ? "" : " (step has not run)"}.
                </p>
              )}
            </Card>

            <Card title="ICP reasons">
              {lead.icpReasons ? (
                <ul className="space-y-3">
                  {lead.icpReasons.map((reason) => (
                    <li key={reason.factor} className="grid grid-cols-[6rem_1fr_3.5rem] items-start gap-3 text-sm">
                      <span className="font-medium text-slate-900">{statusLabel(reason.factor)}</span>
                      <div className="pt-1.5">
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${reason.max ? (reason.points / reason.max) * 100 : 0}%` }}
                          />
                        </div>
                        <div className="mt-1.5 text-xs text-slate-500">{reason.detail}</div>
                      </div>
                      <span className="text-right font-mono text-xs text-slate-600 tabular-nums">
                        {reason.points}/{reason.max}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Not scored (lead stopped before the ICP step).</p>
              )}
            </Card>

            <Card title="Contacts">
              {leadContacts.length === 0 ? (
                <p className="text-sm text-slate-500">No contacts in the payload.</p>
              ) : (
                <div className="-mx-5 -mb-5 overflow-x-auto border-t border-slate-200">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Title</th>
                        <th>Email</th>
                        <th>Gate result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leadContacts.map((contact) => {
                        const excluded = (lastGates?.output as { excludedContacts?: { id: string; reason: string }[] } | null)
                          ?.excludedContacts?.find((c) => c.id === contact.id);
                        return (
                          <tr key={contact.id} className={contact.selected ? "bg-emerald-50/60" : undefined}>
                            <td className="font-medium text-slate-900">{contact.fullName ?? "–"}</td>
                            <td className="text-slate-600">{contact.title ?? "–"}</td>
                            <td className="text-slate-600">{contact.email ?? "–"}</td>
                            <td className="text-xs">
                              {contact.selected ? (
                                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                  <Icon name="check" className="size-3.5" /> Selected
                                </span>
                              ) : (
                                <span className="text-slate-500">{excluded?.reason ?? "eligible, not chosen"}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Instantly request / response">
              {pushSteps.length === 0 && <p className="text-sm text-slate-500">Not pushed.</p>}
              <div className="space-y-5">
                {pushSteps.map((step) => (
                  <div key={step.id} className="space-y-2">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className={`size-2 rounded-full ${STEP_DOT[step.status]}`} />
                      {formatDateTime(step.createdAt)} · attempt {step.attempt} · {step.status}
                      {step.error && <span className="text-red-600">· {step.error}</span>}
                    </p>
                    {step.input != null && (
                      <Collapsible title="Request">
                        <Json value={step.input} />
                      </Collapsible>
                    )}
                    <Collapsible title="Response">
                      <Json value={step.output} />
                    </Collapsible>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="min-w-0 space-y-6">
            <Card title="Company">
              <DescriptionList
                columns={2}
                items={[
                  ["Industry", company.industry],
                  ["Employees", company.employeeRange],
                  ["Country", company.country],
                  ["Revenue", company.revenueRange],
                ]}
              />
              <div className="mt-5 border-t border-slate-100 pt-4">
                <div className="text-xs font-medium text-slate-500">Pages visited</div>
                <ul className="mt-2 space-y-2">
                  {lead.pages.map((page) => (
                    <li key={`${page.path}${page.at ?? ""}`} className="text-sm break-all">
                      <code>{page.path}</code>
                      {page.title && <div className="mt-0.5 text-xs text-slate-500">{page.title}</div>}
                    </li>
                  ))}
                  {lead.pages.length === 0 && <li className="text-sm text-slate-500">None</li>}
                </ul>
              </div>
            </Card>

            <Card title="Pipeline">
              {steps.length === 0 ? (
                <p className="text-sm text-slate-500">No steps yet.</p>
              ) : (
                <ol className="ml-1 space-y-4 border-l border-slate-200 pl-5">
                  {steps.map((step) => (
                    <li key={step.id} className="relative">
                      <span className={`absolute top-1.5 -left-[26px] size-2.5 rounded-full ring-4 ring-white ${STEP_DOT[step.status]}`} />
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{statusLabel(step.step)}</span>
                        <span className="font-mono text-xs text-slate-400">{step.createdAt.toISOString().slice(11, 19)}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {step.provider} · {step.status}
                        {step.durationMs != null && ` · ${step.durationMs} ms`}
                      </div>
                      {step.error && <div className="mt-0.5 text-xs break-words text-red-600">{step.error}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>

        <Card title="Raw Happierleads payload" description={`raw_event ${rawEvent.id}`}>
          {rawEvent.error && <p className="mb-3 text-sm text-red-700">{rawEvent.error}</p>}
          <Collapsible title="Show payload">
            <Json value={rawEvent.payload} />
          </Collapsible>
        </Card>
      </div>
    </>
  );
}
