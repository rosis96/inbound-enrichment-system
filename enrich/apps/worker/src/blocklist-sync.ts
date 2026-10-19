import { and, clients, eq, gt, inArray, isNotNull, isNull, lt, lte, or, suppression } from "@enrich/db";
import { blocklistEntryIds, createInstantlyBlocklistEntries, deleteInstantlyBlocklistEntry, INSTANTLY_BLOCKLIST_BATCH } from "@enrich/providers";
import { decryptSecret } from "@enrich/shared/crypto";
import type { WorkerContext } from "./context";

export const BLOCKLIST_SYNC_INTERVAL_MS = 60_000;
/** A failed entry is tried again after this long. */
const RETRY_AFTER_MS = 60 * 60_000;
const DELETES_PER_RUN = 100;

/**
 * Copies every client's active suppression entries to its Instantly blocklist, which stops emails to
 * leads already in a campaign, and deletes the copies of expired entries. Skipped in dry run (global or
 * the client's), so nothing reaches Instantly until the client is live; pending entries go then.
 */
export async function syncBlocklists(ctx: WorkerContext): Promise<void> {
  if (ctx.env.GLOBAL_DRY_RUN) return;
  const live = await ctx.db
    .select({ id: clients.id, apiKeyEnc: clients.instantlyApiKeyEnc })
    .from(clients)
    .where(and(eq(clients.dryRun, false), isNotNull(clients.instantlyApiKeyEnc)));
  for (const client of live) {
    try {
      const apiKey = decryptSecret(client.apiKeyEnc!, ctx.env.ENCRYPTION_KEY);
      await addPending(ctx, client.id, apiKey);
      await removeExpired(ctx, client.id, apiKey);
    } catch (error) {
      ctx.logger.error({ err: error, clientId: client.id }, "blocklist sync failed");
    }
  }
}

async function addPending(ctx: WorkerContext, clientId: string, apiKey: string): Promise<void> {
  const now = new Date();
  const due = and(
    eq(suppression.clientId, clientId),
    isNull(suppression.instantlyEntryId),
    or(isNull(suppression.expiresAt), gt(suppression.expiresAt, now)),
    or(isNull(suppression.instantlyCheckedAt), lt(suppression.instantlyCheckedAt, new Date(now.getTime() - RETRY_AFTER_MS))),
  );
  const pending = await ctx.db.select({ id: suppression.id }).from(suppression).where(due).limit(INSTANTLY_BLOCKLIST_BATCH);
  if (pending.length === 0) return;

  // Claim the rows by stamping them, so a second worker running the same sync skips them.
  const ids = pending.map((row) => row.id);
  await ctx.db.update(suppression).set({ instantlyCheckedAt: now }).where(and(inArray(suppression.id, ids), due));
  const claimed = await ctx.db
    .select({ id: suppression.id, value: suppression.value })
    .from(suppression)
    .where(and(inArray(suppression.id, ids), eq(suppression.instantlyCheckedAt, now)));
  if (claimed.length === 0) return;

  const { outcome } = await createInstantlyBlocklistEntries(apiKey, claimed.map((row) => row.value));
  if (outcome.kind !== "ok") {
    await ctx.db
      .update(suppression)
      .set({ instantlyError: `${outcome.code}${outcome.status ? ` (HTTP ${outcome.status})` : ""}` })
      .where(inArray(suppression.id, claimed.map((row) => row.id)));
    ctx.logger.warn({ clientId, code: outcome.code, entries: claimed.length }, "Instantly blocklist rejected the entries, will retry");
    return;
  }

  const entryIds = blocklistEntryIds(outcome.body);
  const rejected: string[] = [];
  for (const row of claimed) {
    const entryId = entryIds.get(row.value);
    if (entryId) await ctx.db.update(suppression).set({ instantlyEntryId: entryId, instantlyError: null }).where(eq(suppression.id, row.id));
    else rejected.push(row.id);
  }
  if (rejected.length > 0) {
    // ASSUMPTION: a value already in the Instantly blocklist is left out of `items` like an invalid one; the docs do not say.
    await ctx.db
      .update(suppression)
      .set({ instantlyError: "not accepted by Instantly (invalid, or already in its blocklist)" })
      .where(inArray(suppression.id, rejected));
  }
  ctx.logger.info({ clientId, added: claimed.length - rejected.length, rejected: rejected.length }, "synced blocklist to Instantly");
}

async function removeExpired(ctx: WorkerContext, clientId: string, apiKey: string): Promise<void> {
  const now = new Date();
  const expired = await ctx.db
    .select({ id: suppression.id, entryId: suppression.instantlyEntryId })
    .from(suppression)
    .where(
      and(
        eq(suppression.clientId, clientId),
        isNotNull(suppression.instantlyEntryId),
        lte(suppression.expiresAt, now),
        or(isNull(suppression.instantlyCheckedAt), lt(suppression.instantlyCheckedAt, new Date(now.getTime() - RETRY_AFTER_MS))),
      ),
    )
    .limit(DELETES_PER_RUN);
  for (const row of expired) {
    const { outcome } = await deleteInstantlyBlocklistEntry(apiKey, row.entryId!);
    // 404: already deleted in Instantly.
    const gone = outcome.kind === "ok" || outcome.status === 404;
    await ctx.db
      .update(suppression)
      .set(gone ? { instantlyEntryId: null, instantlyCheckedAt: null, instantlyError: null } : { instantlyCheckedAt: now, instantlyError: `delete failed: ${outcome.code}` })
      .where(eq(suppression.id, row.id));
  }
  if (expired.length > 0) ctx.logger.info({ clientId, expired: expired.length }, "removed expired entries from the Instantly blocklist");
}

/** Runs the sync now and every interval. Returns a stop function. */
export function startBlocklistSync(ctx: WorkerContext, intervalMs = BLOCKLIST_SYNC_INTERVAL_MS): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await syncBlocklists(ctx);
    } catch (error) {
      ctx.logger.error({ err: error }, "blocklist sync failed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}
