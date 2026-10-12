import { asc, clients, companies, contacts, eq, enrichmentSteps, getDb, leads, rawEvents } from "@enrich/db";
import { getEnv } from "@enrich/shared/env";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import { requireAdmin } from "@/lib/auth";
import { reprocessLead } from "./actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Json({ value }: { value: unknown }) {
  return <pre className="pre">{JSON.stringify(value, null, 2)}</pre>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
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
  const lastGates = [...steps].reverse().find((step) => step.step === "gates");
  const dryRun = getEnv().GLOBAL_DRY_RUN || client.dryRun;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <Link href="/leads" className="text-sm text-slate-500 hover:underline">
            ← Leads
          </Link>
          <h1 className="text-xl font-semibold">{company.name ?? company.domain}</h1>
          <p className="text-sm text-slate-500">
            {company.domain} · {client.name} · received {lead.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC
          </p>
        </div>
        <form action={reprocessLead} className="ml-auto">
          <input type="hidden" name="leadId" value={lead.id} />
          <button type="submit" className="btn-primary">
            Reprocess
          </button>
        </form>
      </div>

      {reprocessed && (
        <p className="rounded bg-sky-50 px-3 py-2 text-sm text-sky-800">
          Reprocessing queued. The worker re-runs normalise → gates → ICP → push; refresh in a few seconds.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <div className="text-xs uppercase text-slate-500">Status</div>
          <div className="mt-1">
            <StatusBadge status={lead.status} />
          </div>
          {lead.skipReason && <div className="mt-1 text-sm text-slate-600">{lead.skipReason}</div>}
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500">ICP score</div>
          <div className="mt-1 font-mono text-2xl">{lead.icpScore ?? "–"}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-slate-500">Intent</div>
          <div className="mt-1 text-sm">
            {lead.intentLevel ?? "–"}
            {lead.intentTopic && <span className="text-slate-500"> · {lead.intentTopic}</span>}
          </div>
          <div className="mt-1 text-xs text-slate-500">{dryRun ? "Dry run is on" : "Live"}</div>
        </div>
      </div>

      <Section title="ICP reasons">
        {lead.icpReasons ? (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {lead.icpReasons.map((reason) => (
                <tr key={reason.factor}>
                  <td className="w-28 py-1.5 font-medium capitalize">{reason.factor}</td>
                  <td className="w-20 py-1.5 font-mono">
                    {reason.points}/{reason.max}
                  </td>
                  <td className="py-1.5 text-slate-600">{reason.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">Not scored (lead stopped before the ICP step).</p>
        )}
      </Section>

      <Section title="Company">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          {(
            [
              ["Industry", company.industry],
              ["Employees", company.employeeRange],
              ["Country", company.country],
              ["Revenue", company.revenueRange],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd>{value ?? "–"}</dd>
            </div>
          ))}
        </dl>
        <div className="text-sm">
          <div className="text-xs text-slate-500">Pages visited</div>
          <ul className="mt-1 space-y-0.5">
            {lead.pages.map((page) => (
              <li key={`${page.path}${page.at ?? ""}`} className="font-mono text-xs">
                {page.path}
                {page.title && <span className="font-sans text-slate-500"> — {page.title}</span>}
              </li>
            ))}
            {lead.pages.length === 0 && <li className="text-slate-500">none</li>}
          </ul>
        </div>
      </Section>

      <Section title="Contacts">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1">Name</th>
              <th className="py-1">Title</th>
              <th className="py-1">Email</th>
              <th className="py-1">Gate result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leadContacts.map((contact) => {
              const excluded = (lastGates?.output as { excludedContacts?: { id: string; reason: string }[] } | null)
                ?.excludedContacts?.find((c) => c.id === contact.id);
              return (
                <tr key={contact.id} className={contact.selected ? "bg-emerald-50" : undefined}>
                  <td className="py-1.5">{contact.fullName ?? "–"}</td>
                  <td className="py-1.5 text-slate-600">{contact.title ?? "–"}</td>
                  <td className="py-1.5 text-slate-600">{contact.email ?? "–"}</td>
                  <td className="py-1.5 text-xs">
                    {contact.selected ? (
                      <span className="font-medium text-emerald-700">selected</span>
                    ) : (
                      <span className="text-slate-500">{excluded?.reason ?? "eligible, not chosen"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {leadContacts.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-slate-500">
                  No contacts in the payload.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Instantly request / response">
        {pushSteps.length === 0 && <p className="text-sm text-slate-500">Not pushed.</p>}
        {pushSteps.map((step) => (
          <div key={step.id} className="space-y-2">
            <p className="text-xs text-slate-500">
              {step.createdAt.toISOString()} · attempt {step.attempt} · {step.status}
              {step.error && ` · ${step.error}`}
            </p>
            {step.input != null && (
              <>
                <div className="text-xs font-medium">Request</div>
                <Json value={step.input} />
              </>
            )}
            <div className="text-xs font-medium">Response</div>
            <Json value={step.output} />
          </div>
        ))}
      </Section>

      <Section title="Pipeline steps">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {steps.map((step) => (
              <tr key={step.id}>
                <td className="py-1.5 font-mono text-xs text-slate-500">{step.createdAt.toISOString().slice(11, 23)}</td>
                <td className="py-1.5 font-medium">{step.step}</td>
                <td className="py-1.5 text-slate-600">{step.provider}</td>
                <td className="py-1.5">{step.status}</td>
                <td className="py-1.5 text-xs text-slate-500">{step.error ?? ""}</td>
                <td className="py-1.5 text-right text-xs text-slate-500">{step.durationMs != null ? `${step.durationMs} ms` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Raw Happierleads payload">
        <p className="text-xs text-slate-500">
          raw_event {rawEvent.id}
          {rawEvent.error && <span className="text-red-700"> · {rawEvent.error}</span>}
        </p>
        <Json value={rawEvent.payload} />
      </Section>
    </div>
  );
}
