"use client";

import { dependencyOrder, effectiveRules, parsePlaceholders, suggestedDependencies, variableDependencies } from "@enrich/shared";
import { useState } from "react";
import { Icon } from "./icons";

export interface AiVariableDraft {
  name: string;
  instructions: string;
  minWords: number;
  maxWords: number;
  maxChars?: number;
  examples: string[];
  dependsOn?: string[];
  sentences?: number;
  startsWith?: string;
}

const PRESETS: AiVariableDraft[] = [
  {
    name: "subject_line",
    instructions: "A short, curious subject line about the prospect's company or role. Lowercase is fine. No clickbait, no emojis.",
    minWords: 2,
    maxWords: 7,
    maxChars: 60,
    examples: [],
  },
  {
    name: "personalized_first_line",
    instructions:
      "The opening line of the email: one specific, factual observation about the prospect's company or role that leads naturally into the offer.",
    minWords: 8,
    maxWords: 25,
    examples: [],
  },
  {
    name: "value_proposition",
    instructions:
      "We specialize in scaling {{companycategory}} by {{what we do}} to help them {{desired outcome}} while solving challenges like {{2-3 challenges}}.\n\nAnd, I have seen how your {{specific named project and why it matters}}, which can be enhanced through {{relevant services}} to achieve {{3-4 benefits}} and {{long-term strategic outcome}}.\n\nUse exactly two sentences and a maximum of 85 words. Sentence two must start with 'And, I have seen'.",
    minWords: 30,
    maxWords: 85,
    examples: [],
  },
  {
    name: "product_complimentary",
    instructions:
      "Start with 'By the way,' and compliment one specific project, product or achievement of theirs ({{a different named project or achievement than in value_proposition}}) and why it stands out. One sentence, under 35 words. Do not include a CTA.",
    minWords: 10,
    maxWords: 35,
    examples: [],
    dependsOn: ["value_proposition"],
  },
  {
    name: "reference",
    instructions:
      "Start with 'In my last email,' and continue the exact idea of {{value_proposition}} in one sentence of under 40 words, adding {{one new benefit for their company category}}. Do not include a CTA.",
    minWords: 10,
    maxWords: 40,
    examples: [],
  },
  {
    name: "ideal_customers",
    instructions: "Who the prospect's company sells to, as a short plural noun phrase (e.g. 'mid-size logistics firms').",
    minWords: 2,
    maxWords: 6,
    examples: [],
  },
  {
    name: "company_category",
    instructions: "What kind of company the prospect is, as a short noun phrase (e.g. 'B2B payroll software provider').",
    minWords: 2,
    maxWords: 6,
    examples: [],
  },
];

const blank = (): AiVariableDraft => ({ name: "", instructions: "", minWords: 5, maxWords: 20, examples: [] });

const KIND_STYLE = {
  dynamic: "bg-brand-50 text-brand-700 ring-brand-600/20",
  data: "bg-slate-100 text-slate-700 ring-slate-500/20",
  variable: "bg-sky-50 text-sky-700 ring-sky-600/20",
} as const;
const KIND_LABEL = { dynamic: "AI-resolved", data: "lead data", variable: "other variable" } as const;

function NumberInput({ label, value, onChange, optional }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; optional?: boolean }) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-slate-600">{label}</span>
      <input
        type="number"
        min={1}
        value={value ?? ""}
        placeholder={optional ? "none" : undefined}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="input mt-1"
      />
    </label>
  );
}

function RulesLine({ variable }: { variable: AiVariableDraft }) {
  const rules = effectiveRules(variable);
  const items: string[] = [`${rules.minWords}-${rules.maxWords} words${rules.from.maxWords === "instructions" ? " (from instructions)" : ""}`];
  if (rules.maxChars) items.push(`≤ ${rules.maxChars} characters`);
  if (rules.sentences) items.push(`${rules.sentences} sentence${rules.sentences === 1 ? "" : "s"}`);
  if (rules.startsWith) items.push(`starts “${rules.startsWith.join("” or “")}”`);
  for (const s of rules.sentenceStarts) items.push(`sentence ${s.sentence} starts “${s.text}”`);
  if (rules.noCta) items.push("no CTA");
  return (
    <p className="mt-2 text-xs text-slate-500">
      <span className="font-medium text-slate-600">Checked automatically:</span> {items.join(" · ")}, no unresolved placeholders, no invented figures.
    </p>
  );
}

export function AiVariablesEditor({ name, initial }: { name: string; initial: AiVariableDraft[] }) {
  const [variables, setVariables] = useState<AiVariableDraft[]>(initial);
  const update = (index: number, patch: Partial<AiVariableDraft>) =>
    setVariables((list) => list.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  const remove = (index: number) => setVariables((list) => list.filter((_, i) => i !== index));
  const unusedPresets = PRESETS.filter((p) => !variables.some((v) => v.name === p.name));
  const named = variables.filter((v) => v.name);
  const order = dependencyOrder(named);

  return (
    <div className="space-y-4">
      {/* Drop dependencies on variables that were removed or renamed. */}
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(
          variables.map((v) => ({ ...v, dependsOn: v.dependsOn?.filter((d) => d !== v.name && named.some((n) => n.name === d)) })),
        )}
      />
      <p className="text-xs text-slate-500">
        Write instructions the way you would brief ChatGPT. Use <code>{"{{anything descriptive}}"}</code> for text the AI should work out from
        the prospect&apos;s website and your services (e.g. <code>{"{{2-3 challenges they might face}}"}</code>), <code>{"{{firstName}}"}</code>{" "}
        or <code>{"{{companyName}}"}</code> for lead data, and <code>{"{{other_variable}}"}</code> to build on another variable.
      </p>
      {!order.ok && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Circular dependency: {order.cycle.join(" → ")}. Saving will fail.</p>
      )}
      {variables.length === 0 && <p className="text-sm text-slate-500">No AI variables. Add one below.</p>}
      {variables.map((variable, index) => {
        const others = named.filter((v) => v.name !== variable.name);
        const placeholders = parsePlaceholders(variable.instructions, others.map((v) => v.name));
        const referenced = new Set(placeholders.filter((p) => p.kind === "variable").map((p) => p.ref!));
        const deps = variable.name ? variableDependencies(variable, named) : [];
        const suggested = variable.name ? suggestedDependencies(variable, named) : [];
        const explicit = variable.dependsOn ?? [];
        const toggleDep = (dep: string) =>
          update(index, { dependsOn: explicit.includes(dep) ? explicit.filter((d) => d !== dep) : [...explicit, dep] });

        return (
          <div key={index} className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-start gap-3">
              <label className="block flex-1 text-xs">
                <span className="font-medium text-slate-600">Name</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    value={variable.name}
                    onChange={(e) => update(index, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, "_") })}
                    placeholder="personalized_first_line"
                    className="input font-mono"
                  />
                  {variable.name && <code className="hidden shrink-0 sm:inline">{`{{${variable.name}}}`}</code>}
                </div>
              </label>
              <button
                type="button"
                onClick={() => remove(index)}
                className="mt-5 rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Remove variable"
              >
                <Icon name="close" className="size-4" />
                <span className="sr-only">Remove</span>
              </button>
            </div>
            <label className="mt-3 block text-xs">
              <span className="font-medium text-slate-600">Instructions for the AI</span>
              <span className="ml-2 text-slate-500">plain instructions or a template with placeholders</span>
              <textarea
                value={variable.instructions}
                onChange={(e) => update(index, { instructions: e.target.value })}
                rows={Math.min(12, Math.max(3, variable.instructions.split("\n").length + 1))}
                className="input mt-1"
                placeholder="What this snippet should say and how it fits into the email"
              />
            </label>
            {placeholders.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {placeholders.map((p) => (
                  <span
                    key={p.raw}
                    title={KIND_LABEL[p.kind]}
                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset ${KIND_STYLE[p.kind]}`}
                  >
                    {p.raw}
                  </span>
                ))}
                <span className="text-[11px] text-slate-400">purple: AI-resolved · grey: lead data · blue: other variable</span>
              </div>
            )}
            <RulesLine variable={variable} />
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <NumberInput label="Min words" value={variable.minWords} onChange={(v) => update(index, { minWords: v ?? 1 })} />
              <NumberInput label="Max words" value={variable.maxWords} onChange={(v) => update(index, { maxWords: v ?? 1 })} />
              <NumberInput label="Max characters" value={variable.maxChars} onChange={(v) => update(index, { maxChars: v })} optional />
              <NumberInput label="Exact sentences" value={variable.sentences} onChange={(v) => update(index, { sentences: v })} optional />
              <label className="block text-xs">
                <span className="font-medium text-slate-600">Must start with</span>
                <input
                  value={variable.startsWith ?? ""}
                  onChange={(e) => update(index, { startsWith: e.target.value || undefined })}
                  placeholder="none"
                  className="input mt-1"
                />
              </label>
            </div>
            {others.length > 0 && (
              <div className="mt-3 text-xs">
                <span className="font-medium text-slate-600">Written after</span>
                <span className="ml-2 text-slate-500">its finished text is given to this variable</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {others.map((other) => {
                    const fromTemplate = referenced.has(other.name);
                    const on = fromTemplate || explicit.includes(other.name);
                    return (
                      <button
                        key={other.name}
                        type="button"
                        disabled={fromTemplate}
                        onClick={() => toggleDep(other.name)}
                        title={fromTemplate ? "Referenced as a placeholder in the instructions" : undefined}
                        className={`rounded-md px-2 py-0.5 font-mono ring-1 ring-inset ${
                          on ? "bg-sky-50 text-sky-700 ring-sky-600/30" : "bg-white text-slate-500 ring-slate-300 hover:bg-slate-50"
                        } disabled:cursor-default`}
                      >
                        {on ? "✓ " : ""}
                        {other.name}
                      </button>
                    );
                  })}
                </div>
                {suggested.length > 0 && (
                  <p className="mt-1.5 text-amber-700">
                    The instructions mention {suggested.join(", ")}; select it above if this variable should be written after it.
                  </p>
                )}
                {deps.length === 0 && suggested.length === 0 && <p className="mt-1 text-slate-400">Independent.</p>}
              </div>
            )}
            <label className="mt-3 block text-xs">
              <span className="font-medium text-slate-600">Good examples</span>
              <span className="ml-2 text-slate-500">optional, one per line; style only, facts are never copied</span>
              <textarea
                value={variable.examples.join("\n")}
                onChange={(e) => update(index, { examples: e.target.value.split("\n") })}
                onBlur={(e) => update(index, { examples: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
                rows={2}
                className="input mt-1"
              />
            </label>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setVariables((list) => [...list, blank()])} className="btn-secondary">
          <Icon name="plus" className="size-4" /> Add variable
        </button>
        {unusedPresets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => setVariables((list) => [...list, preset])}
            className="chip font-mono"
            title={preset.instructions}
          >
            + {preset.name}
          </button>
        ))}
      </div>
    </div>
  );
}
