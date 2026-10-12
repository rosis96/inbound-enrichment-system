import { asc, clients, getDb } from "@enrich/db";
import { parseClientSettings, SENIORITIES } from "@enrich/shared";
import { getEnv } from "@enrich/shared/env";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { saveSettings } from "./actions";

export const dynamic = "force-dynamic";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      <div className="mt-1">{children}</div>
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

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const allClients = await getDb().select().from(clients).orderBy(asc(clients.name));
  const client = allClients.find((c) => c.id === params.client) ?? allClients[0];
  if (!client) {
    return (
      <p className="text-sm text-slate-500">
        No clients yet. Run <code>pnpm db:seed</code>.
      </p>
    );
  }

  const settings = parseClientSettings(client.settings);
  const globalDryRun = getEnv().GLOBAL_DRY_RUN;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-xl font-semibold">Settings</h1>
        {allClients.map((c) => (
          <Link
            key={c.id}
            href={`/settings?client=${c.id}`}
            className={`rounded px-2 py-1 text-xs ${c.id === client.id ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {params.saved && (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Saved. New leads use these settings; use Reprocess on a lead to re-score it.
        </p>
      )}
      {params.error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">Not saved: {params.error}</p>}

      <form action={saveSettings} className="space-y-4">
        <input type="hidden" name="clientId" value={client.id} />

        <section className="card space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sending</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="dryRun" defaultChecked={client.dryRun} />
            <span className="font-medium">Dry run for this client</span>
            <span className="text-xs text-slate-500">save the Instantly request instead of sending it</span>
          </label>
          {globalDryRun && (
            <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              GLOBAL_DRY_RUN=true in .env: every client is in dry run regardless of this switch.
            </p>
          )}
          <Field label="Instantly campaign ID" hint="UUID, used for every intent level">
            <input
              name="campaignDefault"
              defaultValue={settings.campaigns.default}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="input font-mono"
            />
          </Field>
          <Field
            label="Instantly API key"
            hint={client.instantlyApiKeyEnc ? "set (stored encrypted); leave blank to keep it" : "not set"}
          >
            <input name="instantlyApiKey" type="password" autoComplete="off" className="input font-mono" />
          </Field>
          {client.instantlyApiKeyEnc && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" name="clearApiKey" /> Remove the stored API key
            </label>
          )}
        </section>

        <section className="card space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">ICP</h2>
          <Field label="Minimum score" hint="0–100; leads below it stop as below_icp">
            <input name="minScore" type="number" min={0} max={100} defaultValue={settings.icp.minScore} className="input w-28" />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
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
            <Field label="Seniorities" hint="half the title points without a keyword match">
              <div className="flex flex-wrap gap-3 pt-1">
                {SENIORITIES.map((s) => (
                  <label key={s} className="flex items-center gap-1.5">
                    <input type="checkbox" name="seniorities" value={s} defaultChecked={settings.icp.seniorities.includes(s)} />
                    {s}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </section>

        <button type="submit" className="btn-primary">
          Save settings
        </button>
      </form>
    </div>
  );
}
