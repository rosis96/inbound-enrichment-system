"use client";

import { useEffect, useRef, useState } from "react";

const boxes = (form: string) => [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${form}"][name="leadId"]`)];

/** Header checkbox that ticks every row checkbox belonging to `form`. */
export function SelectAll({ form }: { form: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const sync = () => {
      const all = boxes(form);
      const ticked = all.filter((b) => b.checked).length;
      if (!ref.current) return;
      ref.current.checked = all.length > 0 && ticked === all.length;
      ref.current.indeterminate = ticked > 0 && ticked < all.length;
    };
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [form]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all leads"
      className="rounded border-slate-300"
      onChange={(event) => {
        for (const box of boxes(form)) box.checked = event.target.checked;
        document.dispatchEvent(new Event("change"));
      }}
    />
  );
}

/** Number of ticked rows and the submit button for the bulk form; asks before queueing. */
export function BulkSubmit({ form, label }: { form: string; label: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () => setCount(boxes(form).filter((b) => b.checked).length);
    sync();
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [form]);
  return (
    <>
      <span className="text-sm text-slate-600">{count} selected</span>
      <button
        type="submit"
        form={form}
        disabled={count === 0}
        className="btn-primary disabled:opacity-50"
        onClick={(event) => {
          if (!confirm(`${label} ${count} lead${count === 1 ? "" : "s"}? Each one runs research and AI writing again, which costs credits.`)) event.preventDefault();
        }}
      >
        {label} {count > 0 ? count : ""}
      </button>
    </>
  );
}
