import { clients, companies, eq, getDb, variableTests } from "@enrich/db";
import { effectiveRules, parseClientSettings, type PersonalisationPlan, type ValidationCheck, type VariableResult } from "@enrich/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { Icon } from "@/components/icons";
import { PendingButton } from "@/components/pending-button";
import { Alert, Card, DescriptionList, PageHeader, timeAgo } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { retestAction, saveInstructionsAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  failed: "bg-red-50 text-red-700 ring-red-600/20",
  blocked: "bg-slate-100 text-slate-600 ring-slate-500/20",
} as const;

const CHECK = {
  pass: { icon: "check", className: "text-emerald-600" },
  warn: { icon: "alert", className: "text-amber-500" },
  fail: { icon: "close", className: "text-red-600" },
} as const;

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${className}`}>{children}</span>;
}

function Phrases({ items, empty = "–" }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <span className="text-slate-400">{empty}</span>;
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

interface PlanCheck {
  unverifiedDetails?: { name: string; evidence: string }[];
  droppedServices?: string[];
  droppedProof?: string[];
}

function PlanCard({ plan, check, error }: { plan: PersonalisationPlan; check: PlanCheck | null; error: string | null }) {
  const removed = check?.unverifiedDetails ?? [];
  const dropped = [...(check?.droppedServices ?? []), ...(check?.droppedProof ?? [])];
  return (
    <Card title="Resolved context" description="One research plan, shared by every variable. Facts come from the website; challenges and benefits are interpretation.">
      {error && (
        <div className="mb-4">
          <Alert tone="warning">The planner failed ({error}), so the variables were written from general information only.</Alert>
        </div>
      )}
      <DescriptionList
        columns={2}
        items={[
          ["Company category", plan.category || "–"],
          ["Industry", plan.industry || "–"],
        ]}
      />
      <div className="mt-4 space-y-4 text-sm">
        <div>
          <div className="text-xs font-medium text-slate-500">What they do (fact)</div>
          <p className="mt-1 text-slate-900">{plan.description || "–"}</p>
          {plan.activities.length > 0 && <p className="mt-1 text-slate-600">{plan.activities.join(" · ")}</p>}
        </div>
        <div>
          <div className="text-xs font-medium text-slate-500">Personalisation details (verified on the website)</div>
          {plan.details.length === 0 ? (
            <p className="mt-1 text-slate-400">None verified, so variables stay general.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {plan.details.map((d) => (
                <li key={d.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs">{d.id}</code>
                    <span className="font-medium text-slate-900">{d.name}</span>
                    <Badge className="bg-slate-50 text-slate-600 ring-slate-500/20">{d.kind.replace("_", " ")}</Badge>
                    {d.id === plan.primaryDetailId && <Badge className="bg-brand-50 text-brand-700 ring-brand-600/20">primary</Badge>}
                    {d.id === plan.alternativeDetailId && <Badge className="bg-sky-50 text-sky-700 ring-sky-600/20">alternative</Badge>}
                  </div>
                  <p className="mt-1 text-slate-600">{d.detail}</p>
                  {d.evidence && <p className="mt-1 text-xs text-slate-500 italic">“{d.evidence}”</p>}
                  {d.sourceUrl && (
                    <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs break-all text-brand-600 hover:underline">
                      {d.sourceUrl}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {removed.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              Removed because they could not be found in the website text: {removed.map((d) => d.name).join(", ")}.
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-medium text-slate-500">Relevant services (client)</div>
            <div className="mt-1">
              <Phrases items={plan.relevantServices} />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Approved proof selected</div>
            <div className="mt-1">
              <Phrases items={plan.proof} />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Possible challenges (interpretation)</div>
            <div className="mt-1">
              <Phrases items={plan.challenges} />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Potential benefits and outcomes (interpretation)</div>
            <div className="mt-1">
              <Phrases items={[...plan.benefits, ...plan.longTermOutcomes]} />
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs font-medium text-slate-500">Unknown (never claimed)</div>
            <p className="mt-1 text-slate-600">{plan.unknowns.join(" · ") || "–"}</p>
          </div>
        </div>
        {dropped.length > 0 && <p className="text-xs text-amber-700">Not in the client&apos;s lists, so not used: {dropped.join(", ")}.</p>}
      </div>
    </Card>
  );
}

function Checks({ checks }: { checks: ValidationCheck[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {checks.map((check) => (
        <li key={check.id} className="flex items-start gap-2">
          <Icon name={CHECK[check.status].icon} className={`mt-0.5 size-4 shrink-0 ${CHECK[check.status].className}`} />
          <span>
            <span className="text-slate-800">{check.label}</span>
            {check.detail && <span className="text-slate-500"> · {check.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function VariableCard({
  result,
  testId,
  instructions,
  rules,
}: {
  result: VariableResult;
  testId: string;
  instructions: string | null;
  rules: string[];
}) {
  const fails = result.checks.filter((c) => c.status === "fail").length;
  const warns = result.checks.filter((c) => c.status === "warn").length;
  return (
    <section id={result.name} className="card scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-sm font-semibold text-slate-900">{`{{${result.name}}}`}</code>
          <Badge className={STATUS[result.status]}>{result.status === "ok" ? "passed" : result.status}</Badge>
          {result.dependsOn.length > 0 && <span className="text-xs text-slate-500">after {result.dependsOn.join(", ")}</span>}
        </div>
        <div className="flex items-center gap-2">
          {result.text && <CopyButton value={result.text} />}
          <form action={retestAction}>
            <input type="hidden" name="testId" value={testId} />
            <input type="hidden" name="mode" value="variable" />
            <PendingButton name="name" value={result.name} pending="Writing…" className="btn-secondary" title="Rewrite this variable (and those that depend on it) with the same research">
              <Icon name="refresh" className="size-4" /> Regenerate
            </PendingButton>
          </form>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm whitespace-pre-line text-slate-900">
        {result.text ?? <span className="text-slate-400">{result.error ?? "No output."}</span>}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {result.words} words · {result.chars} characters · {result.attempts.length} attempt{result.attempts.length === 1 ? "" : "s"}
        {fails > 0 && <span className="text-red-600"> · {fails} failed</span>}
        {warns > 0 && <span className="text-amber-600"> · {warns} warning{warns === 1 ? "" : "s"}</span>}
        {result.error && result.text && <span className="text-red-600"> · {result.error}</span>}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-medium text-slate-500">Placeholders</h3>
          {result.placeholders.length === 0 ? (
            <p className="mt-1 text-sm text-slate-400">None; plain instructions.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {result.placeholders.map((p) => {
                  const inner = p.raw.replace(/^\{\{\s*|\s*\}\}$/g, "");
                  const value = result.resolved[p.raw] ?? result.resolved[inner];
                  return (
                    <tr key={p.raw} className="align-top">
                      <td className="py-1.5 pr-3">
                        <code className="text-xs">{p.raw}</code>
                        <div className="text-[11px] text-slate-400">{p.kind === "dynamic" ? "AI-resolved" : p.kind === "data" ? "lead data" : "variable"}</div>
                      </td>
                      <td className="py-1.5 text-slate-700">
                        {value ?? <span className="text-slate-400">–</span>}
                        {result.insufficientEvidence.includes(p.raw) || result.insufficientEvidence.includes(inner) ? (
                          <div className="text-[11px] text-amber-600">insufficient evidence; kept general</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <h3 className="mt-5 text-xs font-medium text-slate-500">Sources</h3>
          {result.sources.length === 0 ? (
            <p className="mt-1 text-sm text-slate-400">No website facts cited.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {result.sources.map((s) => (
                <li key={`${s.url}${s.label}`}>
                  <span className="text-slate-700">{s.label}</span>:{" "}
                  <a href={s.url} target="_blank" rel="noreferrer" className="break-all text-brand-600 hover:underline">
                    {s.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-xs font-medium text-slate-500">Validation</h3>
          <div className="mt-2">{result.checks.length > 0 ? <Checks checks={result.checks} /> : <p className="text-sm text-slate-400">Not checked.</p>}</div>
          {result.attempts.length > 1 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-slate-500">Earlier attempts ({result.attempts.length - 1})</summary>
              <ol className="mt-2 space-y-2">
                {result.attempts.slice(0, -1).map((a, i) => (
                  <li key={i} className="rounded-md border border-slate-200 px-3 py-2">
                    <p className="whitespace-pre-line text-slate-700">{a.text || "(empty)"}</p>
                    <p className="mt-1 text-xs text-red-600">{a.problems.join(" · ")}</p>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </div>

      {instructions !== null && (
        <details className="mt-5 border-t border-slate-100 pt-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Edit instructions</summary>
          <form action={saveInstructionsAction} className="mt-3 space-y-3">
            <input type="hidden" name="testId" value={testId} />
            <input type="hidden" name="name" value={result.name} />
            <textarea name="instructions" defaultValue={instructions} rows={8} className="input font-mono text-xs" />
            <p className="text-xs text-slate-500">Checked rules: {rules.join(" · ")}</p>
            <PendingButton pending="Saving and writing…" className="btn-primary">
              Save to client settings and regenerate
            </PendingButton>
          </form>
        </details>
      )}
    </section>
  );
}

function rulesSummary(rules: ReturnType<typeof effectiveRules>): string[] {
  const list = [`${rules.minWords}-${rules.maxWords} words`];
  if (rules.maxChars) list.push(`≤ ${rules.maxChars} characters`);
  if (rules.sentences) list.push(`${rules.sentences} sentence${rules.sentences === 1 ? "" : "s"}`);
  if (rules.startsWith) list.push(`starts “${rules.startsWith}”`);
  for (const s of rules.sentenceStarts) list.push(`sentence ${s.sentence} starts “${s.text}”`);
  if (rules.noCta) list.push("no CTA");
  return list;
}

export default async function VariableTestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;
  const [row] = await getDb()
    .select({ test: variableTests, company: companies, client: clients })
    .from(variableTests)
    .innerJoin(companies, eq(variableTests.companyId, companies.id))
    .innerJoin(clients, eq(variableTests.clientId, clients.id))
    .where(eq(variableTests.id, id));
  if (!row) notFound();
  const { test, company, client } = row;
  const settings = parseClientSettings(client.settings);
  const results = Object.values(test.results);
  const untested = settings.aiVariables.filter((v) => !test.results[v.name]);
  const contact = [test.contact.firstName, test.contact.lastName].filter(Boolean).join(" ");

  const modeButton = (mode: string, label: string, hint: string, primary = false) => (
    <PendingButton name="mode" value={mode} pending="Working…" className={primary ? "btn-primary" : "btn-secondary"} title={hint}>
      {label}
    </PendingButton>
  );

  return (
    <>
      <PageHeader
        back={
          <Link href={`/variable-lab?client=${client.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
            <Icon name="arrowLeft" className="size-4" /> Variable lab
          </Link>
        }
        title={<span className="font-mono">{company.domain}</span>}
        description={`${client.name}${contact ? ` · ${contact}` : ""}${test.contact.title ? `, ${test.contact.title}` : ""} · ${test.model ?? "model unknown"} · $${test.costUsd.toFixed(4)} · updated ${timeAgo(test.updatedAt)}`}
        actions={
          <form action={retestAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="testId" value={test.id} />
            {modeButton("all", "Test all variables", "Rewrite every variable with the same research", true)}
            {modeButton("replan", "Retest without recrawling", "New research plan from the stored website text, then every variable")}
            {modeButton("refresh", "Refresh website research", "Read the website again, new plan, every variable")}
          </form>
        }
      />
      {error && (
        <div className="mb-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {untested.length > 0 && (
        <div className="mb-6">
          <Alert tone="info">Not in this test yet: {untested.map((v) => v.name).join(", ")}. Use “Test all variables”.</Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="min-w-0 space-y-6">
          {results.map((result) => {
            const variable = settings.aiVariables.find((v) => v.name === result.name);
            return (
              <VariableCard
                key={result.name}
                result={result}
                testId={test.id}
                instructions={variable?.instructions ?? null}
                rules={variable ? rulesSummary(effectiveRules(variable)) : []}
              />
            );
          })}
        </div>
        <div className="min-w-0">{test.plan && <PlanCard plan={test.plan} check={test.planCheck as PlanCheck | null} error={test.planError} />}</div>
      </div>
    </>
  );
}
