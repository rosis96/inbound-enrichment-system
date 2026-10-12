import type { LeadStatus } from "@enrich/shared";

const STYLES: Partial<Record<LeadStatus, string>> = {
  pushed: "bg-emerald-100 text-emerald-800",
  dry_run_complete: "bg-sky-100 text-sky-800",
  below_icp: "bg-amber-100 text-amber-800",
  gated_out: "bg-slate-200 text-slate-700",
  no_contact: "bg-slate-200 text-slate-700",
  failed: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-violet-100 text-violet-800"}`}>
      {status}
    </span>
  );
}
