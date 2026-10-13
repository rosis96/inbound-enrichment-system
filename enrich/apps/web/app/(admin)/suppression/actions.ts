"use server";

import { parseSuppressionEntries } from "@enrich/core";
import { and, clients, eq, getDb, sql, suppression } from "@enrich/db";
import { SUPPRESSION_REASONS, type SuppressionReason } from "@enrich/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

function back(clientId: string, params: Record<string, string>): never {
  redirect(`/suppression?${new URLSearchParams({ client: clientId, ...params })}`);
}

/** Adds pasted and/or uploaded entries for one client; existing entries get the new reason and expiry. */
export async function addSuppression(formData: FormData): Promise<void> {
  await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "");
  const db = getDb();
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
  if (!client) redirect("/suppression");

  const reason = String(formData.get("reason") ?? "manual") as SuppressionReason;
  if (!SUPPRESSION_REASONS.includes(reason)) back(client.id, { error: "Pick a reason" });
  const days = Number(String(formData.get("expiresDays") ?? "").trim() || 0);
  const expiresAt = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000) : null;

  const pasted = String(formData.get("entries") ?? "");
  const file = formData.get("file");
  const uploaded = file instanceof File && file.size > 0 ? await file.text() : "";
  const { entries, skipped } = parseSuppressionEntries(`${pasted}\n${uploaded}`);
  if (entries.length === 0) {
    back(client.id, { error: skipped.length ? `Nothing usable found (skipped: ${skipped.slice(0, 5).join(", ")})` : "Enter at least one domain or email" });
  }

  const source = uploaded ? ("csv" as const) : ("manual" as const);
  // Insert in chunks so a large CSV stays within MySQL's packet limits.
  for (let i = 0; i < entries.length; i += 500) {
    await db
      .insert(suppression)
      .values(entries.slice(i, i + 500).map((e) => ({ clientId: client.id, kind: e.kind, value: e.value, reason, source, expiresAt })))
      .onDuplicateKeyUpdate({ set: { reason: sql`values(reason)`, expiresAt: sql`values(expires_at)`, updatedAt: new Date() } });
  }
  revalidatePath("/suppression");
  back(client.id, { added: String(entries.length), skipped: String(skipped.length) });
}

export async function removeSuppression(formData: FormData): Promise<void> {
  await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "");
  const id = String(formData.get("id") ?? "");
  await getDb().delete(suppression).where(and(eq(suppression.id, id), eq(suppression.clientId, clientId)));
  revalidatePath("/suppression");
  back(clientId, { removed: "1" });
}
