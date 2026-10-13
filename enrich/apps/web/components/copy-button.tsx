"use client";

import { useState } from "react";
import { Icon } from "./icons";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
    >
      <Icon name={copied ? "check" : "copy"} className="size-3.5" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
