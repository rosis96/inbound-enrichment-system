import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { Alert } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { login } from "./actions";

const ERRORS: Record<string, string> = {
  invalid: "Wrong email or password.",
  config: "Login is not configured: set SESSION_SECRET in .env and restart.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <Icon name="bolt" className="size-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">Sign in to Enrich</h1>
          <p className="mt-1 text-sm text-slate-500">Inbound lead enrichment admin</p>
        </div>
        <form action={login} className="card space-y-4 p-6 shadow-sm">
          {error && <Alert tone="error">{ERRORS[error] ?? "Login failed."}</Alert>}
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Email</span>
            <input name="email" type="email" required autoComplete="username" className="input mt-1.5" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Password</span>
            <input name="password" type="password" required autoComplete="current-password" className="input mt-1.5" />
          </label>
          <button type="submit" className="btn-primary w-full">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
