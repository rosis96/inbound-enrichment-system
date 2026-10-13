import { and, asc, clients, count, desc, eq, getDb, gt, isNull, like, or, suppression, type SQL } from "@enrich/db";
import { SUPPRESSION_REASONS, type SuppressionReason } from "@enrich/shared";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { statusLabel } from "@/components/status-badge";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { addSuppression, removeSuppression } from "./actions";

export const dynamic = "force-dynamic";

const LIMIT = 500;

const REASON_HINTS: Record<SuppressionReason, string> = {
  customer: "Existing clients of this client",
  open_deal: "Already in a sales conversation",
  competitor: "Competitors and agencies",
  do_not_contact: "Asked not to be contacted",
  unsubscribed: "Unsubscribed from emails",
  bounced: "Email bounced",
  replied: "Already replied",
  manual: "Anything else",
};

export default async function SuppressionPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; q?: string; reason?: string; added?: string; skipped?: string; removed?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const db = getDb();
  const allClients = await db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name));
  const client = allClients.find((c) => c.id === params.client) ?? allClients[0];
  if (!client) {
    return (
      <>
        <PageHeader title="Suppression" />
        <div className="card">
          <EmptyState title="No clients yet" />
        </div>
      </>
    );
  }

  const reason = SUPPRESSION_REASONS.includes(params.reason as SuppressionReason) ? (params.reason as SuppressionReason) : undefined;
  const q = params.q?.trim().toLowerCase() ?? "";
  const filters: SQL[] = [eq(suppression.clientId, client.id)];
  if (reason) filters.push(eq(suppression.reason, reason));
  if (q) filters.push(like(suppression.value, `%${q}%`));

  const [rows, byReason] = await Promise.all([
    db.select().from(suppression).where(and(...filters)).orderBy(desc(suppression.createdAt)).limit(LIMIT),
    db
      .select({ reason: suppression.reason, n: count() })
      .from(suppression)
      .where(and(eq(suppression.clientId, client.id), or(isNull(suppression.expiresAt), gt(suppression.expiresAt, new Date()))))
      .groupBy(suppression.reason),
  ]);
  const total = byReason.reduce((t, r) => t + Number(r.n), 0);
  const now = Date.now();
  const href = (change: Record<string, string | undefined>) => {
    const merged = { client: client.id, q: q || undefined, reason, ...change };
    return `/suppression?${new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1])))}`;
  };

  return (
    <>
      <PageHeader
        title="Suppression"
        description={`Domains and emails ${client.name}'s leads are never sent to. A suppressed domain also covers its subdomains and every email on it.`}
      />

      {allClients.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {allClients.map((c) => (
            <Link key={c.id} href={`/suppression?client=${c.id}`} className={`chip ${c.id === client.id ? "chip-active" : ""}`}>
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-6 space-y-3 empty:hidden">
        {params.added && (
          <Alert tone="success">
            Added or updated {params.added} {params.added === "1" ? "entry" : "entries"}
            {params.skipped && params.skipped !== "0" ? `; skipped ${params.skipped} that were not a domain or email` : ""}. New leads are checked against them;
            use Reprocess on existing leads.
          </Alert>
        )}
        {params.removed && <Alert tone="success">Removed.</Alert>}
        {params.error && <Alert tone="error">{params.error}</Alert>}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <Link href={href({ reason: undefined })} className={`chip ${!reason ? "chip-active" : ""}`}>
              All · {total}
            </Link>
            {SUPPRESSION_REASONS.map((r) => {
              const n = Number(byReason.find((b) => b.reason === r)?.n ?? 0);
              if (n === 0 && reason !== r) return null;
              return (
                <Link key={r} href={href({ reason: r })} className={`chip ${reason === r ? "chip-active" : ""}`}>
                  {statusLabel(r)} · {n}
                </Link>
              );
            })}
          </div>
          <form action="/suppression" className="flex gap-2">
            <input type="hidden" name="client" value={client.id} />
            {reason && <input type="hidden" name="reason" value={reason} />}
            <input name="q" defaultValue={q} placeholder="Search domain or email" className="input max-w-xs" />
            <button type="submit" className="btn-secondary">
              Search
            </button>
          </form>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Domain / email</th>
                  <th>Reason</th>
                  <th>Source</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title={q || reason ? "Nothing matches" : "Nothing suppressed yet"}>
                        {!q && !reason && "Add competitors and existing customers so they never get cold emails."}
                      </EmptyState>
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= now;
                  return (
                    <tr key={row.id} className={expired ? "opacity-50" : undefined}>
                      <td>
                        <span className="font-mono text-sm text-slate-900">{row.value}</span>
                        <span className="ml-2 text-xs text-slate-400">{row.kind}</span>
                      </td>
                      <td className="text-slate-600">{statusLabel(row.reason)}</td>
                      <td className="text-xs text-slate-500">{row.source}</td>
                      <td className="text-xs text-slate-500">
                        {row.expiresAt ? (expired ? "expired" : row.expiresAt.toISOString().slice(0, 10)) : "never"}
                      </td>
                      <td className="text-right">
                        <form action={removeSuppression}>
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="id" value={row.id} />
                          <button type="submit" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove">
                            <Icon name="close" className="size-4" />
                            <span className="sr-only">Remove</span>
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === LIMIT && <p className="text-xs text-slate-500">Showing the latest {LIMIT}; search to find others.</p>}
        </div>

        <Card title="Add" description="Paste domains, website URLs or emails, or upload a CSV; anything else is skipped." className="h-fit xl:sticky xl:top-8">
          <form action={addSuppression} className="space-y-4">
            <input type="hidden" name="clientId" value={client.id} />
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Domains or emails</span>
              <span className="ml-2 text-xs text-slate-500">one per line</span>
              <textarea name="entries" rows={6} className="input mt-1.5 font-mono text-xs" placeholder={"competitor.com\nhttps://www.agency.co.uk\njane@customer.org"} />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">or CSV file</span>
              <input
                type="file"
                name="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="mt-1.5 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Reason</span>
              <select name="reason" defaultValue="competitor" className="input mt-1.5">
                {SUPPRESSION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {statusLabel(r)} — {REASON_HINTS[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Expires after</span>
              <span className="ml-2 text-xs text-slate-500">days, blank = never</span>
              <input name="expiresDays" type="number" min={1} placeholder="never" className="input mt-1.5 w-32" />
            </label>
            <button type="submit" className="btn-primary w-full">
              <Icon name="plus" className="size-4" /> Add to suppression
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
