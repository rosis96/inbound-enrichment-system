import {
  buildInstantlyLead,
  checkSequence,
  instantlyPreviewValues,
  renderParts,
  SEQUENCE_TEMPLATES,
  variantLabel,
  type RenderedPart,
} from "@enrich/core";
import { and, asc, clients, companies, contacts, desc, eq, getDb, isNotNull, leads } from "@enrich/db";
import { BUILTIN_INSTANTLY_VARIABLES, INSTANTLY_SYSTEM_PLACEHOLDERS, knownPlaceholders, parseClientSettings } from "@enrich/shared";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { SequenceEditor } from "@/components/sequence-editor";
import { Alert, Card, EmptyState, formatDateTime, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { saveCampaignSetup, saveSequence, syncCampaign } from "./actions";

export const dynamic = "force-dynamic";

const NOTICES = {
  saved: "Sequence saved.",
  setup: "Campaign settings saved.",
  created: "Campaign created in Instantly (paused). Review it there, then launch it. New leads are pushed into it.",
  updated: "Sequence and schedule pushed to the Instantly campaign.",
} as const;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Parts({ parts }: { parts: RenderedPart[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.variable ? (
          <mark
            key={i}
            title={`{{${part.variable}}}`}
            className={`rounded-sm ${part.missing ? "bg-red-100 text-red-700" : "bg-brand-50 text-brand-800"}`}
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

export default async function SequencePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; lead?: string; notice?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const db = getDb();
  const allClients = await db.select().from(clients).orderBy(asc(clients.name));
  const client = allClients.find((c) => c.id === params.client) ?? allClients[0];
  if (!client) {
    return (
      <>
        <PageHeader title="Sequence" />
        <div className="card">
          <EmptyState title="No clients yet">
            Add one on the{" "}
            <Link href="/clients" className="text-brand-600 hover:underline">
              Clients
            </Link>{" "}
            page.
          </EmptyState>
        </div>
      </>
    );
  }

  const settings = parseClientSettings(client.settings);
  const { steps, lastSync } = settings.sequence;
  const setup = settings.campaignSetup;
  const known = knownPlaceholders(settings);
  const issues = checkSequence(steps, settings, known);
  const errors = issues.filter((i) => i.level === "error");
  const campaignId = settings.campaigns.default;

  // Recent leads with a chosen contact, for the preview.
  const previewLeads = await db
    .select({ lead: leads, company: companies, contact: contacts })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .innerJoin(contacts, and(eq(contacts.leadId, leads.id), eq(contacts.selected, true), isNotNull(contacts.email)))
    .where(eq(leads.clientId, client.id))
    .orderBy(desc(leads.createdAt))
    .limit(10);
  const preview = previewLeads.find((row) => row.lead.id === params.lead) ?? previewLeads[0];
  const values = preview
    ? instantlyPreviewValues(
        buildInstantlyLead({
          campaignId: null,
          contact: { ...preview.contact, email: preview.contact.email! },
          company: preview.company,
          lead: preview.lead,
          customVariables: settings.customVariables,
        }),
        { firstName: settings.copy.senderName.split(" ")[0] || undefined },
      )
    : {};

  const chipGroups = [
    { group: "AI", names: settings.aiVariables.map((v) => v.name) },
    { group: "Custom", names: settings.customVariables.map((v) => v.name) },
    { group: "Lead", names: [...new Set([...INSTANTLY_SYSTEM_PLACEHOLDERS, ...BUILTIN_INSTANTLY_VARIABLES])].filter((n) => n !== "enrichLeadId") },
  ];

  return (
    <>
      <PageHeader
        title="Sequence"
        description={`The emails Instantly sends to ${client.name}'s leads. Variables are filled per lead.`}
      />

      {allClients.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {allClients.map((c) => (
            <Link key={c.id} href={`/sequence?client=${c.id}`} className={`chip ${c.id === client.id ? "chip-active" : ""}`}>
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <div id="top" className="mb-6 space-y-3 empty:hidden">
        {params.notice && params.notice in NOTICES && <Alert tone="success">{NOTICES[params.notice as keyof typeof NOTICES]}</Alert>}
        {params.error && <Alert tone="error">{params.error}</Alert>}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <form action={saveSequence} className="min-w-0 space-y-4">
          <input type="hidden" name="clientId" value={client.id} />
          <SequenceEditor
            // Remount after a save so the editor shows what was stored.
            key={JSON.stringify(steps)}
            name="steps"
            initial={steps}
            templates={SEQUENCE_TEMPLATES}
            variables={chipGroups}
          />
          <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur">
            <span className="mr-auto text-xs text-slate-500">Save to update checks and preview</span>
            <button type="submit" className="btn-primary">
              Save sequence
            </button>
          </div>
        </form>

        <div className="min-w-0 space-y-6">
          <Card title="Checks">
            {steps.length > 0 && issues.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <Icon name="check" className="size-4" /> No problems found.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {issues.map((issue, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${issue.level === "error" ? "bg-red-500" : "bg-amber-400"}`} />
                    <span>
                      {issue.step && (
                        <span className="font-medium text-slate-900">
                          Step {issue.step}
                          {issue.variant && ` ${issue.variant}`}:{" "}
                        </span>
                      )}
                      <span className="text-slate-600">{issue.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {errors.length > 0 && <p className="mt-3 text-xs text-slate-500">Errors must be fixed before pushing to Instantly.</p>}
          </Card>

          <Card
            title="Preview"
            description="Saved sequence rendered for a real lead. Highlighted text is filled in; red is missing."
          >
            {!preview ? (
              <p className="text-sm text-slate-500">No leads with a contact yet. Process a lead to preview.</p>
            ) : (
              <div className="space-y-4">
                <form className="flex gap-2" action="/sequence">
                  <input type="hidden" name="client" value={client.id} />
                  <select name="lead" defaultValue={preview.lead.id} className="input">
                    {previewLeads.map((row) => (
                      <option key={row.lead.id} value={row.lead.id}>
                        {row.contact.fullName ?? row.contact.email} · {row.company.name ?? row.company.domain}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn-secondary">
                    Show
                  </button>
                </form>
                {!preview.contact.aiVariables && settings.aiVariables.length > 0 && (
                  <Alert tone="warning">This lead has no AI variables yet; reprocess it to generate them.</Alert>
                )}
                {steps.map((step, i) => {
                  const variant = step.variants[0]!;
                  return (
                    <div key={i} className="rounded-lg border border-slate-200 text-sm">
                      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                        <span>
                          Step {i + 1}
                          {step.variants.length > 1 && ` · version ${variantLabel(0)} of ${step.variants.length}`}
                        </span>
                        <span>{i === 0 ? "Day 0" : `+${step.waitDays} days`}</span>
                      </div>
                      <div className="space-y-2 p-3">
                        <div className="font-semibold text-slate-900">
                          {variant.subject ? <Parts parts={renderParts(variant.subject, values)} /> : <span className="font-normal text-slate-400">Re: (same thread)</span>}
                        </div>
                        <div className="whitespace-pre-wrap text-slate-700">
                          <Parts parts={renderParts(variant.body, values)} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card
            id="instantly"
            title="Instantly campaign"
            description={
              campaignId
                ? "Linked. Pushing replaces the campaign's sequence and schedule with the ones here."
                : "No campaign linked. Creating one makes a paused campaign in Instantly and links it to this client."
            }
          >
            <div className="space-y-4">
              {campaignId && (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <div className="text-slate-500">Campaign ID</div>
                  <div className="truncate font-mono text-slate-800">{campaignId}</div>
                  {lastSync && <div className="mt-1 text-slate-500">Last pushed {formatDateTime(new Date(lastSync.at))}</div>}
                </div>
              )}

              <form action={saveCampaignSetup} className="space-y-3 text-sm">
                <input type="hidden" name="clientId" value={client.id} />
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Campaign name</span>
                  <input name="name" defaultValue={setup.name} placeholder={`${client.name} – inbound`} className="input mt-1" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-600">Send from</span>
                    <input name="from" type="time" defaultValue={setup.from} className="input mt-1" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-600">Until</span>
                    <input name="to" type="time" defaultValue={setup.to} className="input mt-1" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Timezone</span>
                  <input name="timezone" defaultValue={setup.timezone} placeholder="America/Chicago" className="input mt-1 font-mono" />
                </label>
                <div>
                  <span className="text-xs font-medium text-slate-600">Days</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {DAYS.map((day, i) => (
                      <label
                        key={day}
                        className="cursor-pointer rounded-md border border-slate-200 px-2 py-1 text-xs has-checked:border-brand-500 has-checked:bg-brand-50 has-checked:text-brand-700"
                      >
                        <input type="checkbox" name="days" value={i} defaultChecked={setup.days.includes(i)} className="sr-only" />
                        {day}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Sending accounts</span>
                  <span className="ml-1 text-xs text-slate-500">emails connected in Instantly, optional</span>
                  <textarea
                    name="sendingAccounts"
                    defaultValue={setup.sendingAccounts.join("\n")}
                    rows={2}
                    className="input mt-1 font-mono text-xs"
                    placeholder="sam@yourdomain.com"
                  />
                </label>
                <div className="grid grid-cols-2 items-end gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-600">Daily limit</span>
                    <input name="dailyLimit" type="number" min={1} defaultValue={setup.dailyLimit} placeholder="Instantly default" className="input mt-1" />
                  </label>
                  <label className="flex items-center gap-2 pb-2 text-xs text-slate-700">
                    <input type="checkbox" name="stopOnReply" defaultChecked={setup.stopOnReply} className="rounded border-slate-300" />
                    Stop on reply
                  </label>
                </div>
                <button type="submit" className="btn-secondary w-full">
                  Save campaign settings
                </button>
              </form>

              <form action={syncCampaign} className="border-t border-slate-100 pt-4">
                <input type="hidden" name="clientId" value={client.id} />
                <button type="submit" className="btn-primary w-full" disabled={errors.length > 0 || steps.length === 0}>
                  <Icon name="bolt" className="size-4" />
                  {campaignId ? "Push sequence to Instantly" : "Create campaign in Instantly"}
                </button>
                <p className="mt-2 text-xs text-slate-500">
                  Uses the saved sequence and campaign settings. {client.instantlyApiKeyEnc ? "" : "Needs the Instantly API key from Settings. "}
                  Nothing is sent to leads until you launch the campaign in Instantly.
                </p>
              </form>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
