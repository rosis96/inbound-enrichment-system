import { asc, clients, companies, desc, eq, getDb, variableTests } from "@enrich/db";
import { parseClientSettings } from "@enrich/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { PendingButton } from "@/components/pending-button";
import { Alert, Card, EmptyState, PageHeader, timeAgo } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { startTestAction } from "./actions";

export const dynamic = "force-dynamic";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export default async function VariableLabPage({ searchParams }: { searchParams: Promise<{ client?: string; variable?: string; error?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const db = getDb();
  const allClients = await db.select().from(clients).orderBy(asc(clients.name));
  if (allClients.length === 0) {
    return (
      <>
        <PageHeader title="Variable lab" />
        <div className="card">
          <EmptyState title="No clients yet">Add one on the Clients page first.</EmptyState>
        </div>
      </>
    );
  }
  const selected = allClients.find((c) => c.id === params.client) ?? allClients[0]!;
  const settings = parseClientSettings(selected.settings);
  const recent = await db
    .select({
      id: variableTests.id,
      domain: companies.domain,
      contact: variableTests.contact,
      results: variableTests.results,
      createdAt: variableTests.createdAt,
      updatedAt: variableTests.updatedAt,
    })
    .from(variableTests)
    .innerJoin(companies, eq(variableTests.companyId, companies.id))
    .where(eq(variableTests.clientId, selected.id))
    .orderBy(desc(variableTests.updatedAt))
    .limit(15);
  // Prefill the form with the last prospect, so testing one variable from Settings is one click.
  const last = recent[0];
  const missingContext = !settings.copy.companyDescription || settings.copy.services.length === 0;

  return (
    <>
      <PageHeader
        title="Variable lab"
        description="Run a prospect's website through the client's AI variables and see the research, the filled placeholders, sources and checks. Nothing is sent to Instantly."
      />
      {params.error && (
        <div className="mb-6">
          <Alert tone="error">{params.error}</Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <form action={startTestAction} className="min-w-0 space-y-6">
          <Card title="Prospect" description="The website is researched once (or reused if read in the last 30 days); every variable uses that research.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <Field label="Website" hint={last ? "required; filled from your last test" : "required"}>
                  <input name="website" required defaultValue={last?.domain ?? ""} list="recent-sites" placeholder="related.com" className="input font-mono" />
                  <datalist id="recent-sites">
                    {[...new Set(recent.map((t) => t.domain))].map((domain) => (
                      <option key={domain} value={domain} />
                    ))}
                  </datalist>
                </Field>
              </div>
              <Field label="First name" hint="for {{firstName}}">
                <input name="firstName" defaultValue={last?.contact.firstName ?? ""} placeholder="Priya" className="input" />
              </Field>
              <Field label="Last name">
                <input name="lastName" defaultValue={last?.contact.lastName ?? ""} className="input" />
              </Field>
              <Field label="Job title">
                <input name="title" defaultValue={last?.contact.title ?? ""} placeholder="VP Marketing" className="input" />
              </Field>
            </div>
          </Card>

          <Card title="Client">
            <div className="space-y-5">
              <input type="hidden" name="clientId" value={selected.id} />
              <div className="text-sm">
                <span className="font-medium text-slate-700">Client</span>
                <span className="ml-2 text-xs text-slate-500">uses its saved business context and AI variables</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {allClients.map((c) => (
                    <Link key={c.id} href={`/variable-lab?client=${c.id}`} className={`chip ${c.id === selected.id ? "chip-active" : ""}`}>
                      {c.name}
                    </Link>
                  ))}
                </div>
                <Link href={`/settings?client=${selected.id}#ai`} className="mt-1.5 inline-block text-xs text-brand-600 hover:underline">
                  Edit {selected.name}&apos;s variables and context
                </Link>
              </div>
              <Field label="Variables to test" hint="one also writes the variables it builds on">
                <select name="variable" defaultValue={settings.aiVariables.some((v) => v.name === params.variable) ? params.variable : ""} className="input">
                  <option value="">All variables ({settings.aiVariables.length})</option>
                  {settings.aiVariables.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" name="refresh" className="mt-0.5 rounded border-slate-300" />
                <span>
                  <span className="font-medium text-slate-900">Re-read the website</span>
                  <span className="block text-xs text-slate-500">Crawl again even if it was read recently.</span>
                </span>
              </label>
              {missingContext && (
                <Alert tone="warning">
                  {selected.name} has no {settings.copy.companyDescription ? "services" : "company description"} yet, so the writer has little to go on for{" "}
                  <code>{"{{what we do}}"}</code>. Add it under{" "}
                  <Link href={`/settings?client=${selected.id}#copy`} className="underline">
                    Settings → Email copy
                  </Link>
                  .
                </Alert>
              )}
              <PendingButton pending="Researching and writing… (up to a minute)" className="btn-primary w-full">
                <Icon name="bolt" className="size-4" /> Run test
              </PendingButton>
              <p className="text-xs text-slate-500">
                Writes {settings.aiVariables.length} variable{settings.aiVariables.length === 1 ? "" : "s"}:{" "}
                {settings.aiVariables.map((v) => v.name).join(", ") || "none"}.
              </p>
            </div>
          </Card>
        </form>

        <Card title="Recent tests" description={selected.name}>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No tests for this client yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((test) => {
                const results = Object.values(test.results);
                const passed = results.filter((r) => r.status === "ok").length;
                return (
                  <li key={test.id}>
                    <Link href={`/variable-lab/${test.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand-700">
                      <span className="truncate font-mono">{test.domain}</span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {passed}/{results.length} passed · {timeAgo(test.updatedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
