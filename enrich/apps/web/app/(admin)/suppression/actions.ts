"use server";

import { parseSuppressionEntries } from "@enrich/core";
import { addToBlocklist, and, clients, eq, getDb, suppression } from "@enrich/db";
import { deleteInstantlyBlocklistEntry, listActiveCampaignPipelines } from "@enrich/providers";
import { ActiveCampaignSettings, parseClientSettings, SUPPRESSION_REASONS, type SuppressionReason } from "@enrich/shared";
import { decryptSecret, encryptSecret } from "@enrich/shared/crypto";
import { getEnv } from "@enrich/shared/env";
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
  const { suppressedLeads } = await addToBlocklist(db, { clientId: client.id, entries, reason, source, expiresAt });
  revalidatePath("/suppression");
  back(client.id, { added: String(entries.length), skipped: String(skipped.length), suppressedLeads: String(suppressedLeads) });
}

/** Removes an entry, and its copy in the client's Instantly blocklist first if it has one. */
export async function removeSuppression(formData: FormData): Promise<void> {
  await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "");
  const id = String(formData.get("id") ?? "");
  const db = getDb();
  const [row] = await db
    .select({ instantlyEntryId: suppression.instantlyEntryId, apiKeyEnc: clients.instantlyApiKeyEnc })
    .from(suppression)
    .innerJoin(clients, eq(suppression.clientId, clients.id))
    .where(and(eq(suppression.id, id), eq(suppression.clientId, clientId)));
  if (!row) back(clientId, { removed: "1" });

  const env = getEnv();
  if (row.instantlyEntryId && row.apiKeyEnc && !env.GLOBAL_DRY_RUN) {
    const apiKey = decryptSecret(row.apiKeyEnc, env.ENCRYPTION_KEY);
    const { outcome } = await deleteInstantlyBlocklistEntry(apiKey, row.instantlyEntryId);
    // 404: already deleted in Instantly.
    if (outcome.kind !== "ok" && outcome.status !== 404) {
      back(clientId, { error: `Not removed: Instantly could not delete its blocklist entry (${outcome.code}). Try again, or delete it in Instantly first.` });
    }
  }
  await db.delete(suppression).where(and(eq(suppression.id, id), eq(suppression.clientId, clientId)));
  revalidatePath("/suppression");
  back(clientId, { removed: "1" });
}

/**
 * Saves the client's ActiveCampaign connection and what to blocklist from it, checks the URL and key
 * by reading the pipelines, and has the worker sync on its next tick.
 */
export async function saveActiveCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "");
  const db = getDb();
  const [client] = await db
    .select({ id: clients.id, settings: clients.settings, apiKeyEnc: clients.activecampaignApiKeyEnc })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!client) redirect("/suppression");

  const parsed = ActiveCampaignSettings.safeParse({
    apiUrl: String(formData.get("acApiUrl") ?? "").trim().replace(/\/+$/, ""),
    stageIds: formData.getAll("acStageIds").map(String),
    tags: String(formData.get("acTags") ?? "")
      .split(/\r?\n/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  });
  if (!parsed.success) {
    const urlIssue = parsed.error.issues.some((issue) => issue.path[0] === "apiUrl");
    back(client.id, {
      error: urlIssue
        ? "ActiveCampaign API URL must be a full URL, e.g. https://acme.api-us1.com"
        : `ActiveCampaign: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    });
  }

  const env = getEnv();
  const typedKey = String(formData.get("acApiKey") ?? "").trim();
  const clearKey = formData.get("acClearKey") === "on" && !typedKey;
  const apiKey = typedKey || (client.apiKeyEnc && !clearKey ? decryptSecret(client.apiKeyEnc, env.ENCRYPTION_KEY) : "");
  if (apiKey && parsed.data.apiUrl) {
    try {
      await listActiveCampaignPipelines({ apiUrl: parsed.data.apiUrl, apiKey });
    } catch (error) {
      back(client.id, { error: `Not saved: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  await db
    .update(clients)
    .set({
      settings: { ...parseClientSettings(client.settings), activecampaign: parsed.data },
      ...(typedKey ? { activecampaignApiKeyEnc: encryptSecret(typedKey, env.ENCRYPTION_KEY) } : {}),
      ...(clearKey ? { activecampaignApiKeyEnc: null } : {}),
      activecampaignSyncedAt: null,
      activecampaignError: null,
    })
    .where(eq(clients.id, client.id));
  revalidatePath("/suppression");
  back(client.id, { acSaved: "1" });
}

/** Has the worker sync the client's ActiveCampaign contacts on its next tick, within a minute. */
export async function syncActiveCampaignNow(formData: FormData): Promise<void> {
  await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "");
  await getDb().update(clients).set({ activecampaignSyncedAt: null }).where(eq(clients.id, clientId));
  revalidatePath("/suppression");
  back(clientId, { acSync: "1" });
}
