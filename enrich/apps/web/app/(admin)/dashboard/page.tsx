import { clients, companies, count, desc, enrichmentSteps, eq, getDb, gte, jobs, leads, sql, workerHeartbeats } from "@enrich/db";
import type { LeadStatus } from "@enrich/shared";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { Card, EmptyState, PageHeader, StatCard, timeAgo } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DAYS = 14;
// The worker beats every 60 s; three missed beats means it is down.
const WORKER_STALE_MS = 3 * 60_000;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  await requireAdmin();
  const db = getDb();
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (DAYS - 1)));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const day = sql<string>`date_format(${leads.createdAt}, '%Y-%m-%d')`;

  const [byStatus, perDay, perClient, recent, heartbeats, queue, [spend]] = await Promise.all([
    db.select({ status: leads.status, n: count() }).from(leads).groupBy(leads.status),
    db.select({ day, n: count() }).from(leads).where(gte(leads.createdAt, since)).groupBy(day),
    db
      .select({
        id: clients.id,
        name: clients.name,
        dryRun: clients.dryRun,
        total: count(leads.id),
        pushed: sql<number>`sum(case when ${leads.status} in ('pushed', 'dry_run_complete') then 1 else 0 end)`,
      })
      .from(clients)
      .leftJoin(leads, eq(leads.clientId, clients.id))
      .groupBy(clients.id)
      .orderBy(desc(count(leads.id))),
    db
      .select({
        id: leads.id,
        status: leads.status,
        score: leads.icpScore,
        createdAt: leads.createdAt,
        companyName: companies.name,
        domain: companies.domain,
        clientName: clients.name,
      })
      .from(leads)
      .innerJoin(companies, eq(leads.companyId, companies.id))
      .innerJoin(clients, eq(leads.clientId, clients.id))
      .orderBy(desc(leads.createdAt))
      .limit(6),
    db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastBeatAt)).limit(5),
    db.select({ state: jobs.state, n: count() }).from(jobs).groupBy(jobs.state),
    db.select({ usd: sql<string>`coalesce(sum(${enrichmentSteps.costUsd}), 0)` }).from(enrichmentSteps).where(gte(enrichmentSteps.createdAt, monthStart)),
  ]);

  const statusCount = (statuses: LeadStatus[]) =>
    byStatus.filter((row) => statuses.includes(row.status)).reduce((total, row) => total + Number(row.n), 0);
  const total = byStatus.reduce((t, row) => t + Number(row.n), 0);
  const sent = statusCount(["pushed", "dry_run_complete"]);
  const filtered = statusCount(["gated_out", "below_icp", "no_contact", "no_valid_email", "rejected"]);
  const failed = statusCount(["failed"]);

  const counts = new Map(perDay.map((row) => [row.day, Number(row.n)]));
  const days = Array.from({ length: DAYS }, (_, i) => {
    const date = new Date(since.getTime() + i * 86_400_000);
    return { key: utcDay(date), label: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), n: counts.get(utcDay(date)) ?? 0 };
  });
  const maxDay = Math.max(1, ...days.map((d) => d.n));
  const last7 = days.slice(-7).reduce((t, d) => t + d.n, 0);

  const statusRows = [...byStatus].map((row) => ({ status: row.status, n: Number(row.n) })).sort((a, b) => b.n - a.n);
  const maxStatus = Math.max(1, ...statusRows.map((r) => r.n));

  const liveWorkers = heartbeats.filter((hb) => now.getTime() - hb.lastBeatAt.getTime() < WORKER_STALE_MS);
  const queued = Number(queue.find((q) => q.state === "created")?.n ?? 0);
  const active = Number(queue.find((q) => q.state === "active")?.n ?? 0);
  const failedJobs = Number(queue.find((q) => q.state === "failed")?.n ?? 0);
  const llmSpend = Number(spend?.usd ?? 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="How inbound leads are moving through enrichment and into Instantly."
        actions={
          <Link href="/leads" className="btn-secondary">
            View all leads <Icon name="arrowRight" className="size-4" />
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Leads received" value={total.toLocaleString()} hint={`${last7} in the last 7 days`} tone="brand" />
        <StatCard
          label="Sent to Instantly"
          value={sent.toLocaleString()}
          hint={total ? `${Math.round((sent / total) * 100)}% of all leads (incl. dry run)` : "No leads yet"}
          tone="green"
        />
        <StatCard label="Filtered out" value={filtered.toLocaleString()} hint="gates, ICP, no contact or email" tone="amber" />
        <StatCard
          label="Failed"
          value={failed.toLocaleString()}
          hint={failed ? <Link href="/leads?status=failed" className="text-red-600 hover:underline">Review failed leads</Link> : "Nothing to fix"}
          tone="red"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Leads per day" description={`Last ${DAYS} days, UTC`} className="xl:col-span-2">
          <div className="flex h-48 items-end gap-0.5" role="img" aria-label={`Leads per day, last ${DAYS} days`}>
            {days.map((d) => (
              <div key={d.key} className="group relative flex h-full flex-1 flex-col justify-end">
                <div
                  className="mx-auto w-full max-w-8 rounded-t bg-brand-500 transition group-hover:bg-brand-700"
                  style={{ height: d.n ? `${Math.max(3, (d.n / maxDay) * 100)}%` : "2px", opacity: d.n ? 1 : 0.25 }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow group-hover:block">
                  {d.label}: <span className="font-semibold">{d.n}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-xs text-slate-500">
            <span>{days[0]!.label}</span>
            <span>{days[Math.floor(DAYS / 2)]!.label}</span>
            <span>{days[DAYS - 1]!.label}</span>
          </div>
        </Card>

        <Card title="System">
          <ul className="space-y-4 text-sm">
            <li className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-slate-900">Worker</div>
                <div className="text-xs text-slate-500">
                  {heartbeats[0] ? `last beat ${timeAgo(heartbeats[0].lastBeatAt, now.getTime())}` : "never started"}
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  liveWorkers.length ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-red-50 text-red-700 ring-red-600/20"
                }`}
              >
                <Icon name={liveWorkers.length ? "check" : "alert"} className="size-3.5" />
                {liveWorkers.length ? `${liveWorkers.length} running` : "Offline"}
              </span>
            </li>
            <li className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-slate-900">Job queue</div>
                <div className="text-xs text-slate-500">
                  {active} active · {queued} waiting
                </div>
              </div>
              {failedJobs > 0 && (
                <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-600/20 ring-inset">
                  {failedJobs} failed
                </span>
              )}
            </li>
            <li className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-slate-900">AI spend this month</div>
                <div className="text-xs text-slate-500">from LLM_PRICE_* in .env</div>
              </div>
              <span className="font-mono text-sm text-slate-900">${llmSpend.toFixed(2)}</span>
            </li>
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Leads by status">
          {statusRows.length === 0 ? (
            <EmptyState title="No leads yet" />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {statusRows.map((row) => (
                  <tr key={row.status}>
                    <td className="w-36 py-1.5 pr-3">
                      <Link href={`/leads?status=${row.status}`}>
                        <StatusBadge status={row.status} />
                      </Link>
                    </td>
                    <td className="py-1.5">
                      <div className="h-2 rounded-r bg-brand-500/80" style={{ width: `${Math.max(2, (row.n / maxStatus) * 100)}%` }} />
                    </td>
                    <td className="w-12 py-1.5 text-right font-mono text-slate-700 tabular-nums">{row.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title="Recent leads"
          className="xl:col-span-2"
          actions={
            <Link href="/leads" className="text-sm font-medium text-brand-600 hover:text-brand-700">
              View all
            </Link>
          }
        >
          {recent.length === 0 ? (
            <EmptyState title="No leads yet">
              Send a sample with <code>pnpm sample:happierleads</code>.
            </EmptyState>
          ) : (
            <ul className="-my-2 divide-y divide-slate-100">
              {recent.map((lead) => (
                <li key={lead.id}>
                  <Link href={`/leads/${lead.id}`} className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-2.5 hover:bg-slate-50">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-600 uppercase">
                      {(lead.companyName ?? lead.domain).slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{lead.companyName ?? lead.domain}</div>
                      <div className="truncate text-xs text-slate-500">
                        {lead.domain} · {lead.clientName}
                      </div>
                    </div>
                    <span className="hidden font-mono text-sm text-slate-600 sm:block">{lead.score ?? "–"}</span>
                    <StatusBadge status={lead.status} />
                    <span className="hidden w-16 text-right text-xs text-slate-500 md:block">{timeAgo(lead.createdAt, now.getTime())}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Clients" className="mt-6" actions={<Link href="/clients" className="text-sm font-medium text-brand-600 hover:text-brand-700">Manage</Link>}>
        {perClient.length === 0 ? (
          <EmptyState title="No clients yet">
            <Link href="/clients" className="text-brand-600 hover:underline">Add your first client</Link>
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {perClient.map((client) => {
              const totalLeads = Number(client.total);
              const pushed = Number(client.pushed ?? 0);
              return (
                <Link key={client.id} href={`/leads?client=${client.id}`} className="rounded-lg border border-slate-200 p-4 transition hover:border-slate-300 hover:shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-900">{client.name}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${client.dryRun ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {client.dryRun ? "dry run" : "live"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-baseline gap-4 text-sm">
                    <span>
                      <span className="font-semibold text-slate-900 tabular-nums">{totalLeads}</span> <span className="text-slate-500">leads</span>
                    </span>
                    <span>
                      <span className="font-semibold text-slate-900 tabular-nums">{pushed}</span> <span className="text-slate-500">sent</span>
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${totalLeads ? (pushed / totalLeads) * 100 : 0}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
