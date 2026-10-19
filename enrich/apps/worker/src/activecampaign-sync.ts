import { blocklistEntries, domainInList, emailDomain, normaliseEmail, type ParsedSuppression } from "@enrich/core";
import { addToBlocklist, and, clients, eq, isNotNull, isNull, lt, or, suppression } from "@enrich/db";
import { activeCampaignDealContacts, activeCampaignTaggedContacts, type ActiveCampaignContact } from "@enrich/providers";
import { parseClientSettings, type ClientSettings, type SuppressionReason } from "@enrich/shared";
import { decryptSecret } from "@enrich/shared/crypto";
import type { WorkerContext } from "./context";

/** How often the worker looks for clients that are due. */
export const ACTIVECAMPAIGN_TICK_MS = 60_000;
/** How long after a sync a client is synced again. */
export const ACTIVECAMPAIGN_SYNC_EVERY_MS = 5 * 60_000;

type Entry = ParsedSuppression & { reason: SuppressionReason; note: string };

/**
 * Turns ActiveCampaign contacts into suppression entries: the email and its company domain, as the
 * blocklist webhook does. A free email domain only blocks the email and the client's own domains are
 * never blocked. The first contact to produce a value keeps it, so tags (meetings booked) come first.
 */
export function activeCampaignEntries(
  sources: { contacts: ActiveCampaignContact[]; reason: SuppressionReason }[],
  settings: Pick<ClientSettings, "freeEmailDomains" | "ownDomains">,
): Entry[] {
  const entries = new Map<string, Entry>();
  for (const { contacts, reason } of sources) {
    for (const contact of contacts) {
      const email = normaliseEmail(contact.email);
      if (!email) continue;
      const domain = emailDomain(email);
      // A colleague of the client's in the CRM (a deal owner added as contact, a test): not a lead.
      if (domain && domainInList(domain, settings.ownDomains)) continue;
      for (const entry of blocklistEntries({ email, domain }, "both", settings.freeEmailDomains)) {
        const key = `${entry.kind}:${entry.value}`;
        if (!entries.has(key)) entries.set(key, { ...entry, reason, note: contact.note });
      }
    }
  }
  return [...entries.values()];
}

/**
 * Copies the contacts of each client's ActiveCampaign deals (in the chosen stages) and tagged contacts
 * into its suppression list; the blocklist sync then sends them to Instantly. Only adds: a value already
 * suppressed keeps its reason, and nothing is removed when a deal or tag goes away in ActiveCampaign.
 * Runs in dry run too, since it only writes to this app's own list.
 */
export async function syncActiveCampaign(ctx: WorkerContext, now = new Date()): Promise<void> {
  const due = await ctx.db
    .select({ id: clients.id, apiKeyEnc: clients.activecampaignApiKeyEnc, settings: clients.settings })
    .from(clients)
    .where(
      and(
        eq(clients.status, "active"),
        isNotNull(clients.activecampaignApiKeyEnc),
        or(isNull(clients.activecampaignSyncedAt), lt(clients.activecampaignSyncedAt, new Date(now.getTime() - ACTIVECAMPAIGN_SYNC_EVERY_MS))),
      ),
    );
  for (const client of due) {
    const settings = parseClientSettings(client.settings);
    const { apiUrl, stageIds, tags } = settings.activecampaign;
    if (!apiUrl || (stageIds.length === 0 && tags.length === 0)) continue;
    let error: string | null = null;
    try {
      const creds = { apiUrl, apiKey: decryptSecret(client.apiKeyEnc!, ctx.env.ENCRYPTION_KEY) };
      const tagged = await activeCampaignTaggedContacts(creds, tags);
      const deals = await activeCampaignDealContacts(creds, stageIds);
      const entries = activeCampaignEntries(
        [
          { contacts: tagged.contacts, reason: "meeting_booked" },
          { contacts: deals, reason: "open_deal" },
        ],
        settings,
      );
      const added = await addNew(ctx, client.id, entries);
      if (tagged.missingTags.length > 0) error = `no ActiveCampaign tag named ${tagged.missingTags.map((t) => `"${t}"`).join(", ")}`;
      ctx.logger.info(
        { clientId: client.id, tagged: tagged.contacts.length, deals: deals.length, entries: entries.length, ...added },
        "synced ActiveCampaign contacts to suppression",
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      ctx.logger.error({ err, clientId: client.id }, "ActiveCampaign sync failed");
    }
    await ctx.db
      .update(clients)
      .set({ activecampaignSyncedAt: now, activecampaignError: error?.slice(0, 2000) ?? null })
      .where(eq(clients.id, client.id));
  }
}

/** Adds the entries that are not suppressed yet, so an entry added by hand keeps its reason and expiry. */
async function addNew(ctx: WorkerContext, clientId: string, entries: Entry[]): Promise<{ added: number; suppressedLeads: number }> {
  const existing = await ctx.db.select({ kind: suppression.kind, value: suppression.value }).from(suppression).where(eq(suppression.clientId, clientId));
  const known = new Set(existing.map((row) => `${row.kind}:${row.value}`));
  const fresh = entries.filter((entry) => !known.has(`${entry.kind}:${entry.value}`));
  if (fresh.length === 0) return { added: 0, suppressedLeads: 0 };
  const { suppressedLeads } = await addToBlocklist(ctx.db, {
    clientId,
    entries: fresh,
    reason: "open_deal",
    source: "activecampaign",
    expiresAt: null,
  });
  return { added: fresh.length, suppressedLeads };
}

/** Runs the sync now and every tick. Returns a stop function. */
export function startActiveCampaignSync(ctx: WorkerContext, intervalMs = ACTIVECAMPAIGN_TICK_MS): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await syncActiveCampaign(ctx);
    } catch (error) {
      ctx.logger.error({ err: error }, "ActiveCampaign sync failed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}
