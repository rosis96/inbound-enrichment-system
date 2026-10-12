import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { login } from "./actions";

const ERRORS: Record<string, string> = {
  invalid: "Wrong email or password.",
  config: "Login is not configured: set SESSION_SECRET in .env and restart.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect("/leads");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Enrich admin</h1>
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{ERRORS[error] ?? "Login failed."}</p>}
        <label className="block text-sm">
          <span className="text-slate-700">Email</span>
          <input name="email" type="email" required autoComplete="username" className="input mt-1" />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="input mt-1" />
        </label>
        <button type="submit" className="btn-primary w-full">
          Sign in
        </button>
      </form>
    </main>
  );
}
