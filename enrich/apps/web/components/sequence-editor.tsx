"use client";

import { useRef, useState } from "react";
import { Icon } from "./icons";

export interface VariantDraft {
  subject: string;
  body: string;
}
export interface StepDraft {
  waitDays: number;
  variants: VariantDraft[];
}
export interface TemplateOption {
  id: string;
  name: string;
  description: string;
  steps: StepDraft[];
}

type Field = { step: number; variant: number; field: "subject" | "body" };
const label = (index: number) => String.fromCharCode(65 + index);
const MAX_STEPS = 10;
const MAX_VARIANTS = 5;

export function SequenceEditor({
  name,
  initial,
  templates,
  variables,
}: {
  name: string;
  initial: StepDraft[];
  templates: TemplateOption[];
  /** Grouped placeholder names for the insert chips. */
  variables: { group: string; names: string[] }[];
}) {
  const [steps, setSteps] = useState<StepDraft[]>(initial);
  // Selected variant tab per step.
  const [tabs, setTabs] = useState<number[]>(initial.map(() => 0));
  const lastFocus = useRef<{ field: Field; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  const setVariant = (step: number, variant: number, patch: Partial<VariantDraft>) =>
    setSteps((list) =>
      list.map((s, i) => (i === step ? { ...s, variants: s.variants.map((v, j) => (j === variant ? { ...v, ...patch } : v)) } : s)),
    );
  const setStep = (step: number, patch: Partial<StepDraft>) => setSteps((list) => list.map((s, i) => (i === step ? { ...s, ...patch } : s)));
  const selectTab = (step: number, tab: number) => setTabs((t) => t.map((x, i) => (i === step ? tab : x)));

  const addStep = () => {
    setSteps((list) => [...list, { waitDays: list.length === 0 ? 0 : 3, variants: [{ subject: "", body: "Hi {{firstName}},\n\n" }] }]);
    setTabs((t) => [...t, 0]);
  };
  const removeStep = (step: number) => {
    setSteps((list) => list.filter((_, i) => i !== step));
    setTabs((t) => t.filter((_, i) => i !== step));
  };
  const moveStep = (step: number, by: -1 | 1) => {
    const to = step + by;
    if (to < 0 || to >= steps.length) return;
    const swap = <T,>(list: T[]) => list.map((x, i) => (i === step ? list[to]! : i === to ? list[step]! : x));
    setSteps(swap);
    setTabs(swap);
  };
  const addVariant = (step: number) => {
    const source = steps[step]!.variants[tabs[step] ?? 0]!;
    setStep(step, { variants: [...steps[step]!.variants, { ...source }] });
    selectTab(step, steps[step]!.variants.length);
  };
  const removeVariant = (step: number, variant: number) => {
    setStep(step, { variants: steps[step]!.variants.filter((_, i) => i !== variant) });
    selectTab(step, Math.max(0, variant - 1));
  };

  const loadTemplate = (id: string) => {
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    if (steps.length > 0 && !window.confirm(`Replace the current sequence with "${template.name}"?`)) return;
    setSteps(structuredClone(template.steps));
    setTabs(template.steps.map(() => 0));
  };

  /** Inserts {{name}} at the cursor of the last focused subject/body. */
  const insert = (variable: string) => {
    const focus = lastFocus.current;
    if (!focus) return;
    const { field, el } = focus;
    const token = `{{${variable}}}`;
    const current = steps[field.step]?.variants[field.variant]?.[field.field] ?? "";
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    setVariant(field.step, field.variant, { [field.field]: current.slice(0, start) + token + current.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const track = (field: Field) => (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    lastFocus.current = { field, el: e.currentTarget };
  };

  return (
    <div className="space-y-4">
      <input type="hidden" name={name} value={JSON.stringify(steps)} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input w-auto"
          value=""
          onChange={(e) => {
            loadTemplate(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">Start from a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.steps.length} steps)
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">Click a subject or body, then a variable below to insert it.</span>
      </div>

      <div className="sticky top-14 z-10 space-y-2 rounded-lg border border-slate-200 bg-white/95 p-3 backdrop-blur lg:top-2">
        {variables.map((group) => (
          <div key={group.group} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-xs font-medium text-slate-500">{group.group}</span>
            {group.names.map((v) => (
              <button
                key={v}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(v)}
                className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
              >
                {v}
              </button>
            ))}
            {group.names.length === 0 && <span className="text-xs text-slate-400">none</span>}
          </div>
        ))}
      </div>

      {steps.map((step, stepIndex) => {
        const tab = Math.min(tabs[stepIndex] ?? 0, step.variants.length - 1);
        const variant = step.variants[tab]!;
        return (
          <div key={stepIndex}>
            {stepIndex > 0 && (
              <div className="flex items-center gap-2 py-2 pl-4 text-sm text-slate-600">
                <span className="h-6 border-l-2 border-dashed border-slate-300" />
                Wait
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={step.waitDays}
                  onChange={(e) => setStep(stepIndex, { waitDays: Math.max(0, Number(e.target.value) || 0) })}
                  className="input w-20 py-1"
                />
                days, then
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
                <span className="flex size-6 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                  {stepIndex + 1}
                </span>
                <span className="text-sm font-medium text-slate-900">{stepIndex === 0 ? "First email" : `Follow-up ${stepIndex}`}</span>
                <div className="ml-2 flex items-center gap-1">
                  {step.variants.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => selectTab(stepIndex, i)}
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${i === tab ? "bg-brand-50 text-brand-700 ring-1 ring-brand-500/30" : "text-slate-500 hover:bg-slate-100"}`}
                    >
                      {label(i)}
                    </button>
                  ))}
                  {step.variants.length < MAX_VARIANTS && (
                    <button
                      type="button"
                      onClick={() => addVariant(stepIndex)}
                      className="rounded-md px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      title="Add an A/B version (copies the current one)"
                    >
                      + version
                    </button>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1 text-slate-400">
                  <button type="button" onClick={() => moveStep(stepIndex, -1)} disabled={stepIndex === 0} className="rounded p-1 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" title="Move up">
                    <Icon name="arrowLeft" className="size-4 rotate-90" />
                  </button>
                  <button type="button" onClick={() => moveStep(stepIndex, 1)} disabled={stepIndex === steps.length - 1} className="rounded p-1 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" title="Move down">
                    <Icon name="arrowLeft" className="size-4 -rotate-90" />
                  </button>
                  <button type="button" onClick={() => removeStep(stepIndex)} className="rounded p-1 hover:bg-red-50 hover:text-red-600" title="Remove step">
                    <Icon name="close" className="size-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-3 p-4">
                <input
                  value={variant.subject}
                  onChange={(e) => setVariant(stepIndex, tab, { subject: e.target.value })}
                  onFocus={track({ step: stepIndex, variant: tab, field: "subject" })}
                  placeholder={stepIndex === 0 ? "Subject" : "Subject (leave empty to reply in the same thread)"}
                  className="input font-medium"
                />
                <textarea
                  value={variant.body}
                  onChange={(e) => setVariant(stepIndex, tab, { body: e.target.value })}
                  onFocus={track({ step: stepIndex, variant: tab, field: "body" })}
                  rows={Math.max(6, variant.body.split("\n").length + 1)}
                  className="input leading-relaxed"
                  placeholder="Email body (plain text)"
                />
                {step.variants.length > 1 && (
                  <button type="button" onClick={() => removeVariant(stepIndex, tab)} className="text-xs text-slate-500 hover:text-red-600">
                    Remove version {label(tab)}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {steps.length < MAX_STEPS && (
        <button type="button" onClick={addStep} className="btn-secondary w-full border-dashed">
          <Icon name="plus" className="size-4" /> Add {steps.length === 0 ? "first email" : "follow-up"}
        </button>
      )}
    </div>
  );
}
