"use client";

import { useState } from "react";
import { Icon } from "./icons";

export interface AiVariableDraft {
  name: string;
  instructions: string;
  minWords: number;
  maxWords: number;
  maxChars?: number;
  examples: string[];
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
    name: "product_complimentary_1",
    instructions: "One sentence connecting what the prospect's company does to our offer, ending with a yes/no question.",
    minWords: 12,
    maxWords: 22,
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

export function AiVariablesEditor({ name, initial }: { name: string; initial: AiVariableDraft[] }) {
  const [variables, setVariables] = useState<AiVariableDraft[]>(initial);
  const update = (index: number, patch: Partial<AiVariableDraft>) =>
    setVariables((list) => list.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  const remove = (index: number) => setVariables((list) => list.filter((_, i) => i !== index));
  const unusedPresets = PRESETS.filter((p) => !variables.some((v) => v.name === p.name));

  return (
    <div className="space-y-4">
      <input type="hidden" name={name} value={JSON.stringify(variables)} />
      {variables.length === 0 && <p className="text-sm text-slate-500">No AI variables. Add one below.</p>}
      {variables.map((variable, index) => (
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
            <textarea
              value={variable.instructions}
              onChange={(e) => update(index, { instructions: e.target.value })}
              rows={2}
              className="input mt-1"
              placeholder="What this snippet should say and how it fits into the email"
            />
          </label>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <NumberInput label="Min words" value={variable.minWords} onChange={(v) => update(index, { minWords: v ?? 1 })} />
            <NumberInput label="Max words" value={variable.maxWords} onChange={(v) => update(index, { maxWords: v ?? 1 })} />
            <NumberInput label="Max characters" value={variable.maxChars} onChange={(v) => update(index, { maxChars: v })} optional />
          </div>
          <label className="mt-3 block text-xs">
            <span className="font-medium text-slate-600">Good examples</span>
            <span className="ml-2 text-slate-500">optional, one per line</span>
            <textarea
              value={variable.examples.join("\n")}
              onChange={(e) => update(index, { examples: e.target.value.split("\n") })}
              onBlur={(e) => update(index, { examples: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
              rows={2}
              className="input mt-1"
            />
          </label>
        </div>
      ))}
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
