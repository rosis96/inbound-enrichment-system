import { and, clients, companies, contacts, desc, eq, getDb, leads, type SQL } from "@enrich/db";
import { LEAD_STATUSES, type LeadStatus } from "@enrich/shared";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; client?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const status = LEAD_STATUSES.includes(params.status as LeadStatus) ? (params.status as LeadStatus) : undefined;
  const db = getDb();

  const filters: SQL[] = [];
  if (status) filters.push(eq(leads.status, status));
  if (params.client) filters.push(eq(leads.clientId, params.client));

  const rows = await db
    .select({
      id: leads.id,
      status: leads.status,
      score: leads.icpScore,
      skipReason: leads.skipReason,
      intentLevel: leads.intentLevel,
      createdAt: leads.createdAt,
      companyName: companies.name,
      domain: companies.domain,
      clientName: clients.name,
      email: contacts.email,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .innerJoin(clients, eq(leads.clientId, clients.id))
    .leftJoin(contacts, and(eq(contacts.leadId, leads.id), eq(contacts.selected, true)))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(leads.createdAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-xl font-semibold">Leads</h1>
        <Link href="/leads" className={`rounded px-2 py-1 text-xs ${!status ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"}`}>
          all
        </Link>
        {LEAD_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/leads?status=${s}`}
            className={`rounded px-2 py-1 text-xs ${status === s ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"}`}
          >
            {s}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">ICP</th>
              <th className="px-3 py-2">Intent</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Client</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  No leads yet. Send a sample with <code>pnpm sample:happierleads</code>.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                  <Link href={`/leads/${row.id}`} className="hover:underline">
                    {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/leads/${row.id}`} className="font-medium hover:underline">
                    {row.companyName ?? row.domain}
                  </Link>
                  <div className="text-xs text-slate-500">{row.domain}</div>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                  {row.skipReason && <div className="mt-0.5 text-xs text-slate-500">{row.skipReason}</div>}
                </td>
                <td className="px-3 py-2 text-right font-mono">{row.score ?? "–"}</td>
                <td className="px-3 py-2 text-slate-600">{row.intentLevel ?? "–"}</td>
                <td className="px-3 py-2 text-slate-600">{row.email ?? "–"}</td>
                <td className="px-3 py-2 text-slate-600">{row.clientName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
