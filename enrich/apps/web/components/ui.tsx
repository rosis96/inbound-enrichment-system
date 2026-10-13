import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`card scroll-mt-6 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// Full class names so Tailwind picks them up.
const DOTS = {
  neutral: "bg-slate-400",
  brand: "bg-brand-500",
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  red: "bg-red-500",
  sky: "bg-sky-500",
} as const;
export type Tone = keyof typeof DOTS;

export function StatCard({ label, value, hint, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span className={`size-2 rounded-full ${DOTS[tone]}`} />
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const ALERTS = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-red-200 bg-red-50 text-red-700",
} as const;

export function Alert({ tone = "info", children }: { tone?: keyof typeof ALERTS; children: ReactNode }) {
  return <div className={`rounded-lg border px-4 py-3 text-sm ${ALERTS[tone]}`}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

/** Label/value pairs in a responsive grid. */
export function DescriptionList({ items, columns = 4 }: { items: [string, ReactNode][]; columns?: 2 | 3 | 4 }) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[columns];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-4 ${cols}`}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium text-slate-500">{label}</dt>
          <dd className="mt-1 text-sm text-slate-900">{value ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function formatDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "3m ago", "2h ago", "5d ago". */
export function timeAgo(date: Date, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
