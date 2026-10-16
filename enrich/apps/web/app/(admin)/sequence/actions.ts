"use server";

import { buildInstantlyCampaign, checkSequence } from "@enrich/core";
import { clients, eq, getDb } from "@enrich/db";
import { createInstantlyCampaign, updateInstantlyCampaign } from "@enrich/providers";
import { ClientSettings, knownPlaceholders, parseClientSettings } from "@enrich/shared";
import { decryptSecret } from "@enrich/shared/crypto";
import { getEnv } from "@enrich/shared/env";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

type Notice = "saved" | "setup" | "created" | "updated";
/** Which campaign's sequence: the personalised one, or the generic one for leads that could not be personalised. */
type Kind = "personalised" | "generic";

const kindOf = (formData: FormData): Kind => (formData.get("kind") === "generic" ? "generic" : "personalised");

function back(clientId: string, kind: Kind, params: { notice?: Notice; error?: string }): never {
  const search = new URLSearchParams({ client: clientId });
  if (kind === "generic") search.set("kind", "generic");
  if (params.notice) search.set("notice", params.notice);
  if (params.error) search.set("error", params.error);
  redirect(`/sequence?${search}#${params.notice === "setup" || params.notice === "created" || params.notice === "updated" ? "instantly" : "top"}`);
}

async function loadClient(formData: FormData) {
  await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "");
  const [client] = await getDb().select().from(clients).where(eq(clients.id, clientId));
  if (!client) redirect("/sequence");
  return client;
}

function issuesText(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");
}

async function save(clientId: string, settings: ClientSettings) {
  await getDb().update(clients).set({ settings }).where(eq(clients.id, clientId));
  revalidatePath("/sequence");
}

export async function saveSequence(formData: FormData): Promise<void> {
  const client = await loadClient(formData);
  const kind = kindOf(formData);
  const key = kind === "generic" ? "genericSequence" : "sequence";
  const existing = parseClientSettings(client.settings);
  let steps: unknown = [];
  try {
    steps = JSON.parse(String(formData.get("steps") ?? "[]"));
  } catch {
    back(client.id, kind, { error: "Could not read the sequence" });
  }
  const parsed = ClientSettings.safeParse({ ...existing, [key]: { ...existing[key], steps } });
  if (!parsed.success) back(client.id, kind, { error: issuesText(parsed.error) });
  await save(client.id, parsed.data);
  back(client.id, kind, { notice: "saved" });
}

export async function saveCampaignSetup(formData: FormData): Promise<void> {
  const client = await loadClient(formData);
  const kind = kindOf(formData);
  const existing = parseClientSettings(client.settings);
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const dailyLimit = Number(text("dailyLimit"));
  const parsed = ClientSettings.safeParse({
    ...existing,
    campaignSetup: {
      name: text("name"),
      timezone: text("timezone") || existing.campaignSetup.timezone,
      from: text("from"),
      to: text("to"),
      days: formData.getAll("days").map(Number),
      sendingAccounts: text("sendingAccounts")
        .split(/[\s,]+/)
        .map((email) => email.toLowerCase())
        .filter(Boolean),
      dailyLimit: text("dailyLimit") && Number.isFinite(dailyLimit) ? dailyLimit : undefined,
      stopOnReply: formData.get("stopOnReply") === "on",
    },
  });
  if (!parsed.success) back(client.id, kind, { error: issuesText(parsed.error) });
  await save(client.id, parsed.data);
  back(client.id, kind, { notice: "setup" });
}

/** Instantly's error message, if the body has one. */
function instantlyMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.error;
    if (typeof message === "string") return message;
  }
  return typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300);
}

/**
 * Creates the client's Instantly campaign from the sequence, or replaces the sequence of the linked one.
 * Both campaigns share the schedule and sending accounts; the generic one gets " – generic" after its name.
 */
export async function syncCampaign(formData: FormData): Promise<void> {
  const client = await loadClient(formData);
  const kind = kindOf(formData);
  const generic = kind === "generic";
  const sequenceKey = generic ? "genericSequence" : "sequence";
  const campaignKey = generic ? "generic" : "default";
  const settings = parseClientSettings(client.settings);
  const { steps } = settings[sequenceKey];

  const errors = checkSequence(steps, settings, knownPlaceholders(settings), { generic }).filter((issue) => issue.level === "error");
  if (errors.length > 0) back(client.id, kind, { error: `Fix the sequence first: ${errors.map((e) => e.message).join("; ")}` });
  if (!client.instantlyApiKeyEnc) back(client.id, kind, { error: "Set the Instantly API key in Settings first" });

  const apiKey = decryptSecret(client.instantlyApiKeyEnc, getEnv().ENCRYPTION_KEY);
  const baseName = settings.campaignSetup.name || `${client.name} – inbound`;
  const name = generic ? `${baseName} – generic` : baseName;
  const body = buildInstantlyCampaign(name, steps, settings.campaignSetup);
  const existingId = settings.campaigns[campaignKey];

  const { outcome } = existingId
    ? await updateInstantlyCampaign(apiKey, existingId, body)
    : await createInstantlyCampaign(apiKey, body);
  if (outcome.kind !== "ok") {
    back(client.id, kind, { error: `Instantly ${outcome.status ?? "network error"}: ${instantlyMessage(outcome.body)}` });
  }

  const campaignId = existingId || outcome.leadId;
  if (!campaignId) back(client.id, kind, { error: "Instantly created the campaign but returned no id; copy it from Instantly into Settings" });

  await save(client.id, {
    ...settings,
    campaigns: { ...settings.campaigns, [campaignKey]: campaignId },
    [sequenceKey]: { ...settings[sequenceKey], lastSync: { at: new Date().toISOString(), campaignId } },
  });
  back(client.id, kind, { notice: existingId ? "updated" : "created" });
}
