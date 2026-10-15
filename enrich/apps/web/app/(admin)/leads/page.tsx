import { and, asc, clients, companies, contacts, desc, eq, getDb, leads, like, or, type SQL } from "@enrich/db";
import { SHOW_ICP } from "@/lib/features";
import { LEAD_STATUSES, type LeadStatus } from "@enrich/shared";
import Link from "next/link";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { EmptyState, PageHeader, timeAgo } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const LIMIT = 200;

type Params = { status?: string; client?: string; q?: string };

/** Builds a /leads URL keeping the other filters. */
function href(params: Params, change: Params): string {
  const merged = { ...params, ...change };
  const search = new URLSearchParams(Object.entries(merged).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const query = search.toString();
  return query ? `/leads?${query}` : "/leads";
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const params = await searchParams;
  const status = LEAD_STATUSES.includes(params.status as LeadStatus) ? (params.status as LeadStatus) : undefined;
  const q = params.q?.trim() ?? "";
  const db = getDb();

  const filters: SQL[] = [];
  if (status) filters.push(eq(leads.status, status));
  if (params.client) filters.push(eq(leads.clientId, params.client));
  if (q) filters.push(or(like(companies.domain, `%${q}%`), like(companies.name, `%${q}%`), like(contacts.email, `%${q}%`))!);

  const [rows, allClients] = await Promise.all([
    db
      .select({
        id: leads.id,
        status: leads.status,
        score: leads.icpScore,
        skipReason: leads.skipReason,
        intentLevel: leads.intentLevel,
        intentTopic: leads.intentTopic,
        createdAt: leads.createdAt,
        companyName: companies.name,
        domain: companies.domain,
        clientName: clients.name,
        email: contacts.email,
        contactName: contacts.fullName,
      })
      .from(leads)
      .innerJoin(companies, eq(leads.companyId, companies.id))
      .innerJoin(clients, eq(leads.clientId, clients.id))
      .leftJoin(contacts, and(eq(contacts.leadId, leads.id), eq(contacts.selected, true)))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(leads.createdAt))
      .limit(LIMIT),
    db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name)),
  ]);
  const now = Date.now();
  const filtering = Boolean(status || params.client || q);

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${rows.length}${rows.length === LIMIT ? "+" : ""} ${filtering ? "matching" : "most recent"} leads`}
      />

      <div className="mb-4 space-y-3">
        <form className="flex flex-wrap items-center gap-2" action="/leads">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q} placeholder="Search company, domain or email" className="input max-w-xs" />
          <select name="client" defaultValue={params.client ?? ""} className="input w-auto">
            <option value="">All clients</option>
            {allClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-secondary">
            Filter
          </button>
          {filtering && (
            <Link href="/leads" className="text-sm text-slate-500 hover:text-slate-900">
              Clear
            </Link>
          )}
        </form>
        <div className="flex flex-wrap gap-1.5">
          <Link href={href(params, { status: undefined })} className={`chip ${!status ? "chip-active" : ""}`}>
            All
          </Link>
          {LEAD_STATUSES.map((s) => (
            <Link key={s} href={href(params, { status: s })} className={`chip ${status === s ? "chip-active" : ""}`}>
              {statusLabel(s)}
            </Link>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Status</th>
              {SHOW_ICP && <th className="text-right">ICP</th>}
              <th>Intent</th>
              <th>Contact</th>
              <th>Client</th>
              <th className="text-right">Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={SHOW_ICP ? 7 : 6}>
                  {filtering ? (
                    <EmptyState title="No leads match these filters" />
                  ) : (
                    <EmptyState title="No leads yet">
                      Send a sample with <code>pnpm sample:happierleads</code>.
                    </EmptyState>
                  )}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="transition hover:bg-slate-50">
                <td>
                  <Link href={`/leads/${row.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                    {row.companyName ?? row.domain}
                  </Link>
                  <div className="text-xs text-slate-500">{row.domain}</div>
                </td>
                <td>
                  <StatusBadge status={row.status} />
                  {row.skipReason && <div className="mt-1 max-w-56 truncate text-xs text-slate-500" title={row.skipReason}>{row.skipReason}</div>}
                </td>
                {SHOW_ICP && <td className="text-right font-mono tabular-nums">{row.score ?? "–"}</td>}
                <td className="text-slate-600">
                  <span className="capitalize">{row.intentLevel ?? "–"}</span>
                  {row.intentTopic && <div className="text-xs text-slate-500">{row.intentTopic}</div>}
                </td>
                <td className="text-slate-600">
                  {row.contactName && <div className="text-slate-900">{row.contactName}</div>}
                  <div className="text-xs">{row.email ?? "–"}</div>
                </td>
                <td className="text-slate-600">{row.clientName}</td>
                <td className="text-right text-xs whitespace-nowrap text-slate-500" title={row.createdAt.toISOString()}>
                  {timeAgo(row.createdAt, now)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
