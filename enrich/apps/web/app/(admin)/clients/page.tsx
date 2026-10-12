import { asc, clients, count, eq, getDb, leads } from "@enrich/db";
import { getEnv } from "@enrich/shared/env";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  await requireAdmin();
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
