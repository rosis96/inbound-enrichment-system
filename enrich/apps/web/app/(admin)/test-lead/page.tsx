import { asc, clients, getDb } from "@enrich/db";
import { SHOW_ICP } from "@/lib/features";
import { parseClientSettings } from "@enrich/shared";
import { getEnv } from "@enrich/shared/env";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { sendTestLead } from "./actions";

export const dynamic = "force-dynamic";

const EMPLOYEES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Check({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 rounded border-slate-300" />
      <span>
        <span className="font-medium text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );
}

export default async function TestLeadPage({ searchParams }: { searchParams: Promise<{ client?: string; error?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const allClients = await getDb().select().from(clients).orderBy(asc(clients.name));
  if (allClients.length === 0) {
    return (
      <>
        <PageHeader title="Test lead" />
        <div className="card">
          <EmptyState title="No clients yet">
            Add one on the{" "}
            <Link href="/clients" className="text-brand-600 hover:underline">
              Clients
            </Link>{" "}
            page first.
          </EmptyState>
        </div>
      </>
    );
  }
  const selected = allClients.find((c) => c.id === params.client) ?? allClients[0]!;
  const settings = parseClientSettings(selected.settings);
  const globalDryRun = getEnv().GLOBAL_DRY_RUN;

  return (
    <>
      <PageHeader
        title="Test lead"
        description="Send a company through the enricher as if Happierleads had found it: filters, website research, AI variables and Instantly."
      />
      {params.error && (
        <div className="mb-6">
          <Alert tone="error">{params.error}</Alert>
        </div>
      )}

      <form action={sendTestLead} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Company" description="Only the website is required; the rest feeds the filters and the AI variables.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <Field label="Website" hint="required">
                  <input name="website" required placeholder="basecamp.com" className="input font-mono" />
                </Field>
              </div>
              <Field label="Company name">
                <input name="companyName" placeholder="Basecamp" className="input" />
              </Field>
              <Field label="Industry" hint={SHOW_ICP && settings.icp.industriesInclude.length ? `ICP: ${settings.icp.industriesInclude.join(", ")}` : undefined}>
                <input name="industry" list="icp-industries" placeholder="Software" className="input" />
                <datalist id="icp-industries">
                  {settings.icp.industriesInclude.map((i) => (
                    <option key={i} value={i} />
                  ))}
                </datalist>
              </Field>
              <Field label="Employees" hint={SHOW_ICP && settings.icp.employeeRanges.length ? `ICP: ${settings.icp.employeeRanges.join(", ")}` : undefined}>
                <select name="employees" defaultValue={settings.icp.employeeRanges[0] ?? ""} className="input">
                  <option value="">Unknown</option>
                  {EMPLOYEES.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Revenue">
                <input name="revenue" placeholder="$1M-$10M" className="input" />
              </Field>
              <Field label="Country" hint={SHOW_ICP && settings.icp.countries.length ? `ICP: ${settings.icp.countries.join(", ")}` : "name or ISO code"}>
                <input name="country" defaultValue={settings.icp.countries[0] ?? ""} placeholder="United Kingdom" className="input" />
              </Field>
              <Field label="City">
                <input name="city" placeholder="London" className="input" />
              </Field>
            </div>
          </Card>

          <Card title="Contact" description="The person who would receive the emails. Leave empty to test a company with no contact.">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="First name">
                <input name="firstName" placeholder="Priya" className="input" />
              </Field>
              <Field label="Last name">
                <input name="lastName" placeholder="Shah" className="input" />
              </Field>
              <Field label="Job title" hint={SHOW_ICP && settings.icp.titleKeywords.length ? `ICP: ${settings.icp.titleKeywords.join(", ")}` : undefined}>
                <input name="title" placeholder="Founder" className="input" />
              </Field>
              <Field label="Email">
                <input name="email" type="email" placeholder="you@yourdomain.com" className="input" />
              </Field>
            </div>
          </Card>

          <Card title="Visit" description="Pages the company looked at on your client's site. High-intent pages set the intent and topic.">
            <Field label="Pages visited" hint="one path per line">
              <textarea
                name="pages"
                rows={3}
                defaultValue={(settings.pages.highIntent.length ? settings.pages.highIntent.slice(0, 2) : ["/", "/pricing"])
                  .map((p) => p.replace(/\*.*$/, ""))
                  .join("\n")}
                className="input font-mono"
              />
            </Field>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Send to">
            <div className="space-y-5">
              <Field label="Client" hint="uses its variables and campaign">
                <select name="clientId" defaultValue={selected.id} className="input">
                  {allClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Check
                name="dryRun"
                defaultChecked
                label="Don't push to Instantly"
                hint="Save the Instantly request on the lead instead of sending it, even for a live client."
              />
              <Check name="skipDedupe" defaultChecked label="Skip the duplicate check" hint="Lets you send the same company again." />
              <Check
                name="freshResearch"
                label="Re-read the website"
                hint="Crawl and summarise again even if this company was researched in the last 30 days."
              />
              {globalDryRun && <Alert tone="warning">GLOBAL_DRY_RUN is on, so nothing is pushed anyway.</Alert>}
              <button type="submit" className="btn-primary w-full">
                <Icon name="bolt" className="size-4" /> Run enricher
              </button>
              <p className="text-xs text-slate-500">You land on the lead page, which updates as each step finishes.</p>
            </div>
          </Card>
        </div>
      </form>
    </>
  );
}
