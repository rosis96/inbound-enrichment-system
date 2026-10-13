import { asc, clients, count, eq, getDb, leads } from "@enrich/db";
import { getEnv } from "@enrich/shared/env";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { Icon } from "@/components/icons";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "./actions";

export const dynamic = "force-dynamic";

function UrlRow({ label, url }: { label: string; url: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 py-1 pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700" title={url}>
          {url}
        </span>
        <CopyButton value={url} />
      </div>
    </div>
  );
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const env = getEnv();
  const rows = await getDb()
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      status: clients.status,
      dryRun: clients.dryRun,
      token: clients.happierleadsToken,
      instantlyToken: clients.instantlyWebhookToken,
      leadCount: count(leads.id),
    })
    .from(clients)
    .leftJoin(leads, eq(leads.clientId, clients.id))
    .groupBy(clients.id)
    .orderBy(asc(clients.name));

  return (
    <>
      <PageHeader title="Clients" description="Each client has its own webhook, ICP, Instantly campaign and email copy." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {params.error && <Alert tone="error">Not added: {params.error}</Alert>}
          {rows.length === 0 && (
            <div className="card">
              <EmptyState title="No clients yet">Add your first client with the form.</EmptyState>
            </div>
          )}
          {rows.map((client) => {
            const live = !(env.GLOBAL_DRY_RUN || client.dryRun);
            return (
              <div key={client.id} className="card">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-semibold text-brand-700 uppercase">
                    {client.name.slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{client.name}</span>
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 capitalize">
                        {client.status}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${live ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                      >
                        {live ? "live" : "dry run"}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500">{client.slug}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/leads?client=${client.id}`} className="btn-secondary">
                      {client.leadCount} {client.leadCount === 1 ? "lead" : "leads"}
                    </Link>
                    <Link href={`/settings?client=${client.id}`} className="btn-secondary">
                      <Icon name="settings" className="size-4" /> Settings
                    </Link>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 md:grid-cols-2">
                  <UrlRow label="Happierleads webhook URL" url={`${env.APP_URL}/api/hooks/happierleads/${client.token}`} />
                  <UrlRow label="Instantly webhook URL" url={`${env.APP_URL}/api/hooks/instantly/${client.instantlyToken}`} />
                </div>
              </div>
            );
          })}
        </div>

        <Card title="Add client" description="Starts in dry run with default settings." className="h-fit xl:sticky xl:top-8">
          <form action={createClient} className="space-y-4">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Name</span>
              <input name="name" required maxLength={255} className="input mt-1" placeholder="Acme Ltd" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Slug</span>
              <span className="ml-2 text-xs text-slate-500">optional, from the name</span>
              <input name="slug" maxLength={100} className="input mt-1" placeholder="acme" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Own domains</span>
              <span className="ml-2 text-xs text-slate-500">comma separated, gated out</span>
              <input name="ownDomains" className="input mt-1" placeholder="acme.com" />
            </label>
            <p className="text-xs text-slate-500">Next you set its ICP, campaign, Instantly API key and email copy.</p>
            <button type="submit" className="btn-primary w-full">
              <Icon name="plus" className="size-4" /> Add client
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
