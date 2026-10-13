"use server";

import { adminUsers, eq, getDb } from "@enrich/db";
import { verifyPassword } from "@enrich/shared/password";
import { redirect } from "next/navigation";
import { AuthConfigError, endSession, startSession } from "@/lib/auth";

export async function login(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const [user] = email ? await getDb().select().from(adminUsers).where(eq(adminUsers.email, email)) : [];
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) redirect("/login?error=invalid");

  try {
    await startSession(user);
  } catch (error) {
    if (error instanceof AuthConfigError) redirect("/login?error=config");
    throw error;
  }
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
