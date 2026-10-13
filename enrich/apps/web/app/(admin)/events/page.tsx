import { and, asc, clients, desc, eq, getDb, leads, rawEvents, type SQL } from "@enrich/db";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Alert, EmptyState, formatDateTime, PageHeader, timeAgo } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { reprocessEvent } from "./actions";

export const dynamic = "force-dynamic";

const LIMIT = 100;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; failed?: string; queued?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const db = getDb();
  const filters: SQL[] = [];
  if (params.client) filters.push(eq(rawEvents.clientId, params.client));

  const [rows, allClients] = await Promise.all([
    db
      .select({ event: rawEvents, clientName: clients.name, leadId: leads.id, leadStatus: leads.status })
      .from(rawEvents)
      .innerJoin(clients, eq(rawEvents.clientId, clients.id))
      .leftJoin(leads, eq(leads.rawEventId, rawEvents.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(rawEvents.receivedAt))
      .limit(LIMIT),
    db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name)),
  ]);
  const shown = params.failed ? rows.filter((r) => r.event.error) : rows;
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Webhook events"
        description="Every payload received from Happierleads, exactly as sent, with what the app made of it."
      />

      {params.queued && (
        <div className="mb-4">
          <Alert tone="info">Reprocessing queued; refresh in a few seconds.</Alert>
        </div>
      )}

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/events">
        <select name="client" defaultValue={params.client ?? ""} className="input w-auto">
          <option value="">All clients</option>
          {allClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="failed" value="1" defaultChecked={Boolean(params.failed)} className="rounded border-slate-300" />
          Only with errors
        </label>
        <button type="submit" className="btn-secondary">
          Filter
        </button>
      </form>

      <div className="space-y-3">
        {shown.length === 0 && (
          <div className="card">
            <EmptyState title="No webhook events yet">Point a Happierleads webhook at a client&apos;s URL from the Clients page.</EmptyState>
          </div>
        )}
        {shown.map(({ event, clientName, leadId, leadStatus }) => (
          <details key={event.id} className="card group p-0">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3">
              <span className={`size-2 shrink-0 rounded-full ${event.error ? "bg-red-500" : leadId ? "bg-emerald-500" : "bg-slate-300"}`} />
              <span className="text-sm font-medium text-slate-900">{clientName}</span>
              <span className="text-xs text-slate-500" title={formatDateTime(event.receivedAt)}>
                {timeAgo(event.receivedAt, now)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{summarise(event.payload)}</span>
              {event.error ? (
                <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-600/20 ring-inset">
                  {event.error}
                </span>
              ) : leadStatus ? (
                <StatusBadge status={leadStatus} />
              ) : (
                <span className="text-xs text-slate-400">{event.processedAt ? "processed" : "waiting"}</span>
              )}
            </summary>
            <div className="space-y-3 border-t border-slate-200 px-5 py-4">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>Received {formatDateTime(event.receivedAt)}</span>
                {event.processedAt && <span>· processed {formatDateTime(event.processedAt)}</span>}
                <span className="font-mono">· {event.id}</span>
                <div className="ml-auto flex items-center gap-2">
                  {leadId && (
                    <Link href={`/leads/${leadId}`} className="btn-secondary py-1 text-xs">
                      Open lead
                    </Link>
                  )}
                  <form action={reprocessEvent}>
                    <input type="hidden" name="eventId" value={event.id} />
                    <button type="submit" className="btn-secondary py-1 text-xs">
                      Reprocess
                    </button>
                  </form>
                </div>
              </div>
              <pre className="pre">{JSON.stringify(event.payload, null, 2)}</pre>
            </div>
          </details>
        ))}
      </div>
      {rows.length === LIMIT && <p className="mt-4 text-xs text-slate-500">Showing the latest {LIMIT} events.</p>}
    </>
  );
}

/** One-line hint of what a payload contains, whatever its shape. */
function summarise(payload: unknown): string {
  if (!payload || typeof payload !== "object") return String(payload);
  const keys = Object.keys(payload as Record<string, unknown>);
  const text = JSON.stringify(payload);
  const domain = text.match(/"(?:domain|website|url)"\s*:\s*"([^"]+)"/i)?.[1];
  return [domain, `${keys.length} fields: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? "…" : ""}`].filter(Boolean).join(" · ");
}
