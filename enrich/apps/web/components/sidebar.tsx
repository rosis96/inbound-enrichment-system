"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/login/actions";
import { Icon, type IconName } from "./icons";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/leads", label: "Leads", icon: "leads" },
  { href: "/sequence", label: "Sequence", icon: "mail" },
  { href: "/clients", label: "Clients", icon: "clients" },
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/integrations", label: "Integrations", icon: "key" },
];

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav className="flex-1 space-y-1 px-3">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon name={item.icon} className={`size-5 ${active ? "text-brand-600" : "text-slate-400"}`} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
        <Icon name="bolt" className="size-4.5" />
      </span>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-slate-900">Enrich</div>
        <div className="text-xs text-slate-500">Inbound pipeline</div>
      </div>
    </div>
  );
}

function Account({ email }: { email: string }) {
  return (
    <div className="border-t border-slate-200 p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 uppercase">
          {email.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-800">{email}</div>
          <div className="text-xs text-slate-500">Admin</div>
        </div>
        <form action={logout}>
          <button type="submit" title="Sign out" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Icon name="logout" className="size-5" />
            <span className="sr-only">Sign out</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function SendingStatus({ dryRun }: { dryRun: boolean }) {
  return (
    <div className="mx-3 mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
      <div className="flex items-center gap-2 font-medium text-slate-700">
        <span className={`size-2 rounded-full ${dryRun ? "bg-amber-400" : "bg-emerald-500"}`} />
        {dryRun ? "Global dry run" : "Live sending"}
      </div>
      <p className="mt-1 text-slate-500">
        {dryRun ? "Instantly requests are saved, not sent." : "Leads go to Instantly unless a client is in dry run."}
      </p>
    </div>
  );
}

export function Sidebar({ email, dryRun }: { email: string; dryRun: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer after navigating.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Brand />
        <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100">
          <Icon name="menu" className="size-6" />
          <span className="sr-only">Open menu</span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between px-5 py-5">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
                <Icon name="close" className="size-5" />
                <span className="sr-only">Close menu</span>
              </button>
            </div>
            <NavLinks pathname={pathname} />
            <SendingStatus dryRun={dryRun} />
            <Account email={email} />
          </aside>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="px-5 py-5">
          <Brand />
        </div>
        <div className="px-6 pb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Menu</div>
        <NavLinks pathname={pathname} />
        <SendingStatus dryRun={dryRun} />
        <Account email={email} />
      </aside>
    </>
  );
}
