import { asc, clients, count, eq, getDb, leads } from "@enrich/db";
import { getEnv } from "@enrich/shared/env";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "./actions";

export const dynamic = "force-dynamic";

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
      leadCount: count(leads.id),
    })
    .from(clients)
    .leftJoin(leads, eq(leads.clientId, clients.id))
    .groupBy(clients.id)
    .orderBy(asc(clients.name));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Clients</h1>
      {params.error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">Not added: {params.error}</p>}

      <form action={createClient} className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Add client</h2>
        <div className="grid gap-3 sm:grid-cols-3">
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
        </div>
        <p className="text-xs text-slate-500">
          Starts in dry run with default settings. You go to its settings next to set ICP, campaign and Instantly API key.
        </p>
        <button type="submit" className="btn-primary">
          Add client
        </button>
      </form>

      {rows.map((client) => (
        <div key={client.id} className="card space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{client.name}</span>
            <span className="text-slate-500">{client.slug}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{client.status}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">
              {env.GLOBAL_DRY_RUN || client.dryRun ? "dry run" : "live"}
            </span>
            <Link href={`/leads?client=${client.id}`} className="ml-auto text-slate-600 hover:underline">
              {client.leadCount} leads
            </Link>
            <Link href={`/settings?client=${client.id}`} className="btn-secondary">
              Settings
            </Link>
          </div>
          <div>
            <div className="text-xs text-slate-500">Happierleads webhook URL</div>
            <code className="break-all text-xs">{`${env.APP_URL}/api/hooks/happierleads/${client.token}`}</code>
          </div>
        </div>
      ))}
    </div>
  );
}
