import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { logout } from "../login/actions";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
          <span className="font-semibold">Enrich</span>
          <Link href="/leads" className="text-slate-600 hover:text-slate-900">Leads</Link>
          <Link href="/clients" className="text-slate-600 hover:text-slate-900">Clients</Link>
          <Link href="/settings" className="text-slate-600 hover:text-slate-900">Settings</Link>
          <form action={logout} className="ml-auto flex items-center gap-3">
            <span className="text-slate-500">{session.email}</span>
            <button type="submit" className="btn-secondary">Sign out</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
