"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Submit button that disables itself and shows `pending` while its form's action runs. */
export function PendingButton({
  children,
  pending,
  className = "btn-primary",
  name,
  value,
  title,
}: {
  children: ReactNode;
  pending: ReactNode;
  className?: string;
  name?: string;
  value?: string;
  title?: string;
}) {
  const status = useFormStatus();
  const busy = status.pending && (name === undefined || status.data?.get(name) === value);
  return (
    <button type="submit" name={name} value={value} title={title} disabled={status.pending} className={`${className} disabled:cursor-wait disabled:opacity-60`}>
      {busy ? pending : children}
    </button>
  );
}
