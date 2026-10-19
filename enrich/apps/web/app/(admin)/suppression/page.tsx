import { and, asc, clients, count, desc, eq, getDb, gt, isNull, like, or, suppression, type SQL } from "@enrich/db";
import { listActiveCampaignPipelines, type ActiveCampaignPipeline } from "@enrich/providers";
import { parseClientSettings, SUPPRESSION_REASONS, type SuppressionReason } from "@enrich/shared";
import { decryptSecret } from "@enrich/shared/crypto";
import { getEnv } from "@enrich/shared/env";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { Icon } from "@/components/icons";
import { statusLabel } from "@/components/status-badge";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { addSuppression, removeSuppression, saveActiveCampaign, syncActiveCampaignNow } from "./actions";

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
  meeting_booked: "Booked a meeting with the client",
  form_submitted: "Filled in a form on the client's site",
  manual: "Anything else",
};

export default async function SuppressionPage({
  searchParams,
}: {
  searchParams: Promise<{
    client?: string;
    q?: string;
    reason?: string;
    added?: string;
    skipped?: string;
    suppressedLeads?: string;
    removed?: string;
    acSaved?: string;
    acSync?: string;
    error?: string;
  }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const db = getDb();
  const env = getEnv();
  const allClients = await db
    .select({
      id: clients.id,
      name: clients.name,
      dryRun: clients.dryRun,
      hasApiKey: clients.instantlyApiKeyEnc,
      blocklistToken: clients.blocklistToken,
      settings: clients.settings,
      acApiKeyEnc: clients.activecampaignApiKeyEnc,
      acSyncedAt: clients.activecampaignSyncedAt,
      acError: clients.activecampaignError,
    })
    .from(clients)
    .orderBy(asc(clients.name));
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

  const ac = parseClientSettings(client.settings).activecampaign;
  const [rows, byReason, [acCount], acPipelines] = await Promise.all([
    db.select().from(suppression).where(and(...filters)).orderBy(desc(suppression.createdAt)).limit(LIMIT),
    db
      .select({ reason: suppression.reason, n: count() })
      .from(suppression)
      .where(and(eq(suppression.clientId, client.id), or(isNull(suppression.expiresAt), gt(suppression.expiresAt, new Date()))))
      .groupBy(suppression.reason),
    db
      .select({ n: count() })
      .from(suppression)
      .where(and(eq(suppression.clientId, client.id), eq(suppression.source, "activecampaign"))),
    // The stages to pick from; an error here shows next to the form rather than breaking the page.
    ac.apiUrl && client.acApiKeyEnc
      ? listActiveCampaignPipelines({ apiUrl: ac.apiUrl, apiKey: decryptSecret(client.acApiKeyEnc, env.ENCRYPTION_KEY) }).catch(
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        )
      : Promise.resolve(null),
  ]);
  const total = byReason.reduce((t, r) => t + Number(r.n), 0);
  // Why entries are not being copied to Instantly, if they are not.
  const syncPaused = env.GLOBAL_DRY_RUN
    ? "GLOBAL_DRY_RUN is on"
    : client.dryRun
      ? "the client is in dry run"
      : !client.hasApiKey
        ? "the client has no Instantly API key"
        : null;
  const webhookUrl = client.blocklistToken ? `${env.APP_URL}/api/hooks/blocklist/${client.blocklistToken}` : null;
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
            {params.skipped && params.skipped !== "0" ? `; skipped ${params.skipped} that were not a domain or email` : ""}. New leads are checked against them
            {params.suppressedLeads && params.suppressedLeads !== "0"
              ? `, and ${params.suppressedLeads} lead${params.suppressedLeads === "1" ? "" : "s"} already sent moved to Suppressed`
              : ""}
            . {syncPaused ? `Not sent to Instantly's blocklist while ${syncPaused}.` : "They go to Instantly's blocklist within a minute."}
          </Alert>
        )}
        {params.removed && <Alert tone="success">Removed.</Alert>}
        {params.acSaved && <Alert tone="success">ActiveCampaign settings saved. The worker syncs within a minute, then every 5 minutes.</Alert>}
        {params.acSync && <Alert tone="success">Resync started: the worker reads ActiveCampaign within a minute; refresh to see the new entries.</Alert>}
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
          <div className="flex flex-wrap items-center gap-2">
            <form action="/suppression" className="flex min-w-0 flex-1 gap-2">
              <input type="hidden" name="client" value={client.id} />
              {reason && <input type="hidden" name="reason" value={reason} />}
              <input name="q" defaultValue={q} placeholder="Search domain or email" className="input max-w-xs" />
              <button type="submit" className="btn-secondary">
                Search
              </button>
            </form>
            {ac.apiUrl && client.acApiKeyEnc && (
              <form action={syncActiveCampaignNow} className="flex items-center gap-2">
                <input type="hidden" name="clientId" value={client.id} />
                <span className="text-xs text-slate-500">
                  ActiveCampaign {client.acSyncedAt ? `synced ${client.acSyncedAt.toISOString().slice(11, 16)} UTC` : "sync pending"}
                </span>
                <button type="submit" className="btn-secondary">
                  <Icon name="refresh" className="size-4" /> Resync now
                </button>
              </form>
            )}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Domain / email</th>
                  <th>Reason</th>
                  <th>Source</th>
                  <th>Expires</th>
                  <th>Instantly</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6}>
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
                        {row.note && <div className="text-xs text-slate-400">{row.note}</div>}
                      </td>
                      <td className="text-slate-600">{statusLabel(row.reason)}</td>
                      <td className="text-xs text-slate-500">{row.source}</td>
                      <td className="text-xs text-slate-500">
                        {row.expiresAt ? (expired ? "expired" : row.expiresAt.toISOString().slice(0, 10)) : "never"}
                      </td>
                      <td className="text-xs">
                        {row.instantlyEntryId ? (
                          <span className="text-emerald-700">{expired ? "removing" : "blocked"}</span>
                        ) : row.instantlyError ? (
                          <span className="text-red-600" title={row.instantlyError}>
                            error
                          </span>
                        ) : expired ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className="text-slate-500" title={syncPaused ?? undefined}>
                            {syncPaused ? "waiting" : "pending"}
                          </span>
                        )}
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

        <ActiveCampaignCard
          clientId={client.id}
          apiUrl={ac.apiUrl}
          hasKey={Boolean(client.acApiKeyEnc)}
          stageIds={ac.stageIds}
          tags={ac.tags}
          pipelines={acPipelines}
          syncedAt={client.acSyncedAt}
          error={client.acError}
          entries={Number(acCount?.n ?? 0)}
        />

        {webhookUrl && (
          <Card
            title="Blocklist webhook"
            description="Have the client's form or booking tool (directly, or through Zapier or Make) POST each submission here."
            className="h-fit xl:col-start-2"
          >
            <div className="space-y-3 text-sm text-slate-600">
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 py-1 pr-1 pl-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700" title={webhookUrl}>
                  {webhookUrl}
                </span>
                <CopyButton value={webhookUrl} />
              </div>
              <p>
                JSON or form fields. Any field with &ldquo;email&rdquo; in its name is read (not the organiser&rsquo;s or host&rsquo;s), and{" "}
                <code>website</code> or <code>domain</code> if sent. The email and the whole company are blocked; a Gmail-type address only
                blocks the email.
              </p>
              <p>
                Options: <code>?reason=meeting_booked</code> (default <code>form_submitted</code>), <code>&amp;block=email</code> or{" "}
                <code>domain</code> (default both), <code>&amp;days=180</code> to expire, <code>&amp;source=calendly</code> as a note.
              </p>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function ActiveCampaignCard(props: {
  clientId: string;
  apiUrl: string;
  hasKey: boolean;
  stageIds: string[];
  tags: string[];
  /** Null without a URL and key; a string when ActiveCampaign could not be read. */
  pipelines: ActiveCampaignPipeline[] | string | null;
  syncedAt: Date | null;
  error: string | null;
  entries: number;
}) {
  const { pipelines } = props;
  const selected = new Set(props.stageIds);
  const configured = props.hasKey && props.apiUrl && (props.stageIds.length > 0 || props.tags.length > 0);
  return (
    <Card
      title="ActiveCampaign"
      description="Blocklists the client's CRM contacts: everyone on a deal in the chosen stages (open deal) and everyone with one of the tags (meeting booked). Email and company domain, as the webhook does. Synced every 5 minutes; only adds."
      className="h-fit xl:col-start-2"
    >
      <div className="space-y-4 text-sm">
        {configured && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>
              {props.entries} {props.entries === 1 ? "entry" : "entries"} from ActiveCampaign ·{" "}
              {props.syncedAt ? `synced ${props.syncedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "sync pending"}
            </span>
            <form action={syncActiveCampaignNow}>
              <input type="hidden" name="clientId" value={props.clientId} />
              <button type="submit" className="btn-secondary shrink-0 px-2.5 py-1 text-xs">
                <Icon name="refresh" className="size-3.5" /> Resync now
              </button>
            </form>
          </div>
        )}
        {props.error && <Alert tone="error">Last sync: {props.error}</Alert>}
        <form action={saveActiveCampaign} className="space-y-4">
          <input type="hidden" name="clientId" value={props.clientId} />
          <label className="block">
            <span className="font-medium text-slate-700">API URL</span>
            <span className="ml-2 text-xs text-slate-500">Settings → Developer</span>
            <input name="acApiUrl" defaultValue={props.apiUrl} placeholder="https://acme.api-us1.com" className="input mt-1.5 font-mono text-xs" />
          </label>
          <label className="block">
            <span className="font-medium text-slate-700">API key</span>
            <span className="ml-2 text-xs text-slate-500">{props.hasKey ? "set (encrypted); blank keeps it" : "not set"}</span>
            <input
              name="acApiKey"
              type="password"
              autoComplete="off"
              placeholder={props.hasKey ? "••••••••••••" : ""}
              className="input mt-1.5 font-mono text-xs"
            />
          </label>
          {props.hasKey && (
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" name="acClearKey" className="rounded border-slate-300" /> Remove the stored API key (stops the sync)
            </label>
          )}
          {typeof pipelines === "string" && <Alert tone="error">Could not read the pipelines: {pipelines}</Alert>}
          {Array.isArray(pipelines) && (
            <div>
              <span className="font-medium text-slate-700">Deal stages</span>
              <span className="ml-2 text-xs text-slate-500">contacts on deals in these stages are blocked</span>
              <div className="mt-1.5 max-h-72 space-y-3 overflow-y-auto rounded-md border border-slate-200 p-3">
                {pipelines.length === 0 && <p className="text-xs text-slate-500">No pipelines in this account.</p>}
                {pipelines.map((pipeline) => (
                  <fieldset key={pipeline.id}>
                    <legend className="text-xs font-semibold text-slate-700">{pipeline.title}</legend>
                    <div className="mt-1 space-y-1">
                      {pipeline.stages.map((stage) => (
                        <label key={stage.id} className="flex items-center gap-2 text-xs text-slate-600">
                          <input type="checkbox" name="acStageIds" value={stage.id} defaultChecked={selected.has(stage.id)} className="rounded border-slate-300" />
                          {stage.title}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>
          )}
          {/* Keep the chosen stages when the pipelines could not be listed. */}
          {!Array.isArray(pipelines) && props.stageIds.map((id) => <input key={id} type="hidden" name="acStageIds" value={id} />)}
          {pipelines === null && <p className="text-xs text-slate-500">Save the URL and key to pick deal stages.</p>}
          <label className="block">
            <span className="font-medium text-slate-700">Tags</span>
            <span className="ml-2 text-xs text-slate-500">one per line, e.g. Meeting Booked</span>
            <textarea name="acTags" defaultValue={props.tags.join("\n")} rows={3} className="input mt-1.5 font-mono text-xs" />
          </label>
          <button type="submit" className="btn-secondary w-full">
            Save ActiveCampaign
          </button>
        </form>
      </div>
    </Card>
  );
}
