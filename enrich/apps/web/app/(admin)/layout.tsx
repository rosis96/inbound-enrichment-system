import { getEnv } from "@enrich/shared/env";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Sidebar email={session.email} dryRun={getEnv().GLOBAL_DRY_RUN} />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
