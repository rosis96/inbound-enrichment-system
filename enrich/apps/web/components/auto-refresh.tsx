"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server page every few seconds while `active`, for up to two minutes. */
export function AutoRefresh({ active, intervalMs = 2500 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let runs = 0;
    const timer = setInterval(() => {
      runs += 1;
      if (runs > 48) clearInterval(timer);
      router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return active ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
      <span className="size-2 animate-pulse rounded-full bg-brand-500" /> Processing… updates automatically
    </span>
  ) : null;
}
