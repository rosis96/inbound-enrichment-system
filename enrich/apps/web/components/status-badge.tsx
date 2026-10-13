import type { LeadStatus } from "@enrich/shared";

const STYLES: Partial<Record<LeadStatus, string>> = {
  pushed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  dry_run_complete: "bg-sky-50 text-sky-700 ring-sky-600/20",
  personalised: "bg-brand-50 text-brand-700 ring-brand-600/20",
  awaiting_review: "bg-violet-50 text-violet-700 ring-violet-600/20",
  below_icp: "bg-amber-50 text-amber-700 ring-amber-600/20",
  gated_out: "bg-slate-100 text-slate-600 ring-slate-500/20",
  no_contact: "bg-slate-100 text-slate-600 ring-slate-500/20",
  no_valid_email: "bg-slate-100 text-slate-600 ring-slate-500/20",
  rejected: "bg-slate-100 text-slate-600 ring-slate-500/20",
  failed: "bg-red-50 text-red-700 ring-red-600/20",
};

/** "below_icp" → "Below ICP". */
export function statusLabel(status: string): string {
  const text = status.replaceAll("_", " ").replace(/\bicp\b/g, "ICP");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${
        STYLES[status] ?? "bg-slate-50 text-slate-600 ring-slate-500/20"
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}
