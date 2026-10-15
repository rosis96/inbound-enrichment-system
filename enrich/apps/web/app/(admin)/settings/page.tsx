import { asc, clients, getDb } from "@enrich/db";
import { BUILTIN_INSTANTLY_VARIABLES, parseClientSettings, SENIORITIES } from "@enrich/shared";
import { getEnv } from "@enrich/shared/env";
import Link from "next/link";
import type { ReactNode } from "react";
import { AiVariablesEditor } from "@/components/ai-variables-editor";
import { Icon } from "@/components/icons";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { SHOW_CUSTOM_VARIABLES, SHOW_ICP } from "@/lib/features";
import { saveSettings } from "./actions";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { id: "sending", label: "Sending" },
  { id: "icp", label: "ICP" },
  { id: "copy", label: "Email copy" },
  { id: "ai", label: "AI variables" },
  { id: "variables", label: "Custom variables" },
].filter((s) => (s.id !== "icp" || SHOW_ICP) && (s.id !== "variables" || SHOW_CUSTOM_VARIABLES));

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function ListField({ name, label, values, hint }: { name: string; label: string; values: string[]; hint?: string }) {
  return (
    <Field label={label} hint={hint ?? "one per line"}>
      <textarea name={name} defaultValue={values.join("\n")} rows={Math.max(3, values.length + 1)} className="input font-mono" />
    </Field>
  );
}

/** Checkbox styled as a switch; still a plain form field. */
function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
        <span className="h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2" />
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-4" />
      </span>
      <span className="text-sm">
        <span className="font-medium text-slate-900">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; saved?: string; created?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const allClients = await getDb().select().from(clients).orderBy(asc(clients.name));
  const client = allClients.find((c) => c.id === params.client) ?? allClients[0];
  if (!client) {
    return (
      <>
        <PageHeader title="Settings" />
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
  const globalDryRun = getEnv().GLOBAL_DRY_RUN;

  return (
    <>
      <PageHeader
        title="Settings"
        description={`Configuration for ${client.name}. Changes apply to new leads.`}
        actions={
          <Link href={`/variable-lab?client=${client.id}`} className="btn-primary" title="Try this client's saved AI variables on any website">
            <Icon name="beaker" className="size-4" /> Test enrichment
          </Link>
        }
      />

      {allClients.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {allClients.map((c) => (
            <Link key={c.id} href={`/settings?client=${c.id}`} className={`chip ${c.id === client.id ? "chip-active" : ""}`}>
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-6 space-y-3 empty:hidden">
        {params.created && (
          <Alert tone="success">
            Client added in dry run. Set its campaign and Instantly API key below; its webhook URL is on the Clients page.
          </Alert>
        )}
        {params.saved && <Alert tone="success">Saved. New leads use these settings; use Reprocess on a lead to re-score it.</Alert>}
        {params.error && <Alert tone="error">Not saved: {params.error}</Alert>}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[11rem_1fr]">
        <nav className="hidden lg:block">
          <ul className="sticky top-8 space-y-1 text-sm">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="block rounded-md px-3 py-1.5 text-slate-600 hover:bg-white hover:text-slate-900">
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <form action={saveSettings} className="min-w-0 space-y-6">
          <input type="hidden" name="clientId" value={client.id} />

          <Card id="sending" title="Sending" description="Where leads go in Instantly, and whether they are actually sent.">
            <div className="space-y-5">
              <Toggle
                name="dryRun"
                label="Dry run for this client"
                hint="Save the Instantly request instead of sending it."
                defaultChecked={client.dryRun}
              />
              {globalDryRun && (
                <Alert tone="warning">GLOBAL_DRY_RUN=true in .env: every client is in dry run regardless of this switch.</Alert>
              )}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="Instantly campaign ID" hint="UUID">
                  <input
                    name="campaignDefault"
                    defaultValue={settings.campaigns.default}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="input font-mono"
                  />
                </Field>
                <Field label="Generic campaign ID" hint="UUID; for leads that could not be personalised">
                  <input
                    name="campaignGeneric"
                    defaultValue={settings.campaigns.generic}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="input font-mono"
                  />
                </Field>
                <Field label="Instantly API key" hint={client.instantlyApiKeyEnc ? "set (encrypted); blank keeps it" : "not set"}>
                  <input
                    name="instantlyApiKey"
                    type="password"
                    autoComplete="off"
                    placeholder={client.instantlyApiKeyEnc ? "••••••••••••" : ""}
                    className="input font-mono"
                  />
                </Field>
              </div>
              {client.instantlyApiKeyEnc && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="clearApiKey" className="rounded border-slate-300" /> Remove the stored API key
                </label>
              )}
            </div>
          </Card>

          <div hidden={!SHOW_ICP}>
          <Card id="icp" title="Ideal customer profile" description="Each factor is worth 20 points; leads below the minimum stop as below_icp.">
            <div className="space-y-5">
              <Field label="Minimum score" hint="0–100">
                <input name="minScore" type="number" min={0} max={100} defaultValue={settings.icp.minScore} className="input w-28" />
              </Field>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <ListField name="countries" label="Countries" values={settings.icp.countries} hint="ISO codes, e.g. GB" />
                <ListField name="employeeRanges" label="Employee ranges" values={settings.icp.employeeRanges} hint="e.g. 11-50, 1000+" />
                <ListField name="industriesInclude" label="Industries" values={settings.icp.industriesInclude} />
                <ListField
                  name="industriesExclude"
                  label="Excluded industries"
                  values={settings.icp.industriesExclude}
                  hint="a match sets the score to 0"
                />
                <ListField name="titleKeywords" label="Title keywords" values={settings.icp.titleKeywords} />
                <ListField name="titleExcludeKeywords" label="Excluded title keywords" values={settings.icp.titleExcludeKeywords} />
                <ListField name="highIntent" label="High-intent pages" values={settings.pages.highIntent} hint="paths, * wildcard" />
                <ListField
                  name="freeEmailDomains"
                  label="Free email domains"
                  values={settings.freeEmailDomains}
                  hint="contacts and companies on these are gated out"
                />
                <Field label="Seniorities" hint="half the title points without a keyword match">
                  <div className="flex flex-wrap gap-2 pt-1">
                    {SENIORITIES.map((s) => (
                      <label
                        key={s}
                        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm has-checked:border-brand-500 has-checked:bg-brand-50 has-checked:text-brand-700"
                      >
                        <input type="checkbox" name="seniorities" value={s} defaultChecked={settings.icp.seniorities.includes(s)} className="sr-only" />
                        {s.replace("_", "-")}
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
            </div>
          </Card>

          </div>

          <Card
            id="copy"
            title="Email copy"
            description={
              <>
                Context the AI uses when writing this client's variables. The email itself is written on the{" "}
                <Link href={`/sequence?client=${client.id}`} className="text-brand-600 hover:underline">
                  Sequence
                </Link>{" "}
                page.
              </>
            }
          >
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Toggle
                  name="aiVariablesEnabled"
                  label="Write AI variables for each lead"
                  hint="Needs an OpenAI key and model on the Integrations page (or in .env)."
                  defaultChecked={settings.copy.aiVariablesEnabled}
                />
                <Toggle
                  name="requireAiVariables"
                  label="Require every AI variable"
                  hint="Fail the lead instead of pushing it with one missing."
                  defaultChecked={settings.copy.requireAiVariables}
                />
              </div>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="Sender name">
                  <input name="senderName" defaultValue={settings.copy.senderName} className="input" placeholder="Sam" />
                </Field>
                <Field label="Tone">
                  <input name="tone" defaultValue={settings.copy.tone} className="input" />
                </Field>
                <Field label="What the sender's company does">
                  <textarea name="companyDescription" defaultValue={settings.copy.companyDescription} rows={3} className="input" />
                </Field>
                <Field label="Offer" hint="what the email proposes">
                  <textarea name="offer" defaultValue={settings.copy.offer} rows={3} className="input" />
                </Field>
                <ListField name="bannedPhrases" label="Banned phrases" values={settings.copy.bannedPhrases} />
                <ListField
                  name="services"
                  label="Services the client can deliver"
                  values={settings.copy.services}
                  hint="one per line; the AI picks only the relevant ones for {{what we do}}"
                />
                <div className="md:col-span-2">
                  <ListField
                    name="proof"
                    label="Approved proof"
                    values={settings.copy.proof}
                    hint="one per line: case studies, research and figures the AI may cite; nothing else is claimed"
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card
            id="ai"
            title="AI variables"
            description={
              <>
                Written for every lead from one research plan of the prospect&apos;s website, in dependency order, checked against these rules
                (corrected up to twice) and sent to Instantly as custom variables. Try them on any website in the{" "}
                <Link href="/variable-lab" className="text-brand-600 hover:underline">
                  Variable lab
                </Link>
                .
              </>
            }
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3">
              <p className="text-sm text-brand-700">
                Test these variables on any website: see each output, its filled placeholders, sources and checks. Save first; the test uses the
                saved settings.
              </p>
              <Link href={`/variable-lab?client=${client.id}`} className="btn-primary shrink-0">
                <Icon name="beaker" className="size-4" /> Test enrichment
              </Link>
            </div>
            <AiVariablesEditor name="aiVariables" initial={settings.aiVariables} clientId={client.id} />
          </Card>

          <div hidden={!SHOW_CUSTOM_VARIABLES}>
          <Card
            id="variables"
            title="Custom variables"
            description={
              <>
                Sent with every lead as Instantly custom variables: <code>calendarLink = https://cal.com/sam</code> becomes{" "}
                <code>{"{{calendarLink}}"}</code> in the campaign.
              </>
            }
          >
            <div className="space-y-4">
              <Field label="Variables" hint="one per line: name = value">
                <textarea
                  name="customVariables"
                  defaultValue={settings.customVariables.map((v) => `${v.name} = ${v.value}`).join("\n")}
                  rows={Math.max(5, settings.customVariables.length + 2)}
                  className="input font-mono"
                  placeholder={"calendarLink = https://cal.com/sam\ngreeting = Hi {{firstName|there}}"}
                />
              </Field>
              <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-600">
                <p>
                  Values can be fixed text or use lead data. Text after <code>|</code> is the fallback when the value is empty, e.g.{" "}
                  <code>{"Hi {{firstName|there}}"}</code>.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[...BUILTIN_INSTANTLY_VARIABLES, ...settings.aiVariables.map((v) => v.name)].map((name) => (
                    <code key={name} className="bg-white ring-1 ring-slate-200">{`{{${name}}}`}</code>
                  ))}
                </div>
              </div>
            </div>
          </Card>
          </div>

          <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur">
            <span className="mr-auto text-xs text-slate-500">Editing {client.name}</span>
            <button type="submit" className="btn-primary">
              Save settings
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
