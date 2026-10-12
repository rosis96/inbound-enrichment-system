"use server";

import { clients, eq, getDb } from "@enrich/db";
import { ClientSettings, SENIORITIES, type Seniority } from "@enrich/shared";
import { encryptSecret } from "@enrich/shared/crypto";
import { getEnv } from "@enrich/shared/env";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

/** One entry per line or comma. */
function list(formData: FormData, name: string): string[] {
  return String(formData.get(name) ?? "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function saveSettings(formData: FormData): Promise<void> {
  await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "");
  const db = getDb();
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) redirect("/settings");

  const existing = ClientSettings.parse(client.settings ?? {});
  const minScore = Number(formData.get("minScore"));

  // Merge form fields over the stored settings so fields not on this form are kept.
  const parsed = ClientSettings.safeParse({
    ...existing,
    icp: {
      ...existing.icp,
      countries: list(formData, "countries").map((c) => c.toUpperCase()),
      employeeRanges: list(formData, "employeeRanges"),
      industriesInclude: list(formData, "industriesInclude"),
      industriesExclude: list(formData, "industriesExclude"),
      titleKeywords: list(formData, "titleKeywords"),
      titleExcludeKeywords: list(formData, "titleExcludeKeywords"),
      seniorities: formData.getAll("seniorities").filter((s): s is Seniority => SENIORITIES.includes(s as Seniority)),
      minScore: Number.isFinite(minScore) ? Math.round(minScore) : existing.icp.minScore,
    },
    pages: { ...existing.pages, highIntent: list(formData, "highIntent") },
    campaigns: { ...existing.campaigns, default: String(formData.get("campaignDefault") ?? "").trim() },
  });
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    redirect(`/settings?client=${clientId}&error=${encodeURIComponent(message)}`);
  }

  const apiKey = String(formData.get("instantlyApiKey") ?? "").trim();
  const clearApiKey = formData.get("clearApiKey") === "on";
  await db
    .update(clients)
    .set({
      settings: parsed.data,
      dryRun: formData.get("dryRun") === "on",
      ...(apiKey ? { instantlyApiKeyEnc: encryptSecret(apiKey, getEnv().ENCRYPTION_KEY) } : {}),
      ...(clearApiKey && !apiKey ? { instantlyApiKeyEnc: null } : {}),
    })
    .where(eq(clients.id, clientId));

  revalidatePath("/settings");
  redirect(`/settings?client=${clientId}&saved=1`);
}
