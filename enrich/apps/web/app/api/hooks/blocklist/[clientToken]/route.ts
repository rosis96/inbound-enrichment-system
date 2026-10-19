import { BLOCKLIST_SCOPES, blocklistEntries, domainInList, parseBlocklistPayload, type BlocklistScope } from "@enrich/core";
import { addToBlocklist, clients, getDb, isNotNull } from "@enrich/db";
import { parseClientSettings, SUPPRESSION_REASONS, type SuppressionReason } from "@enrich/shared";
import { constantTimeEqual } from "@enrich/shared/crypto";
import { createLogger } from "@enrich/shared/logger";

export const dynamic = "force-dynamic";

const logger = createLogger({ name: "web" });
const MAX_BODY_BYTES = 1_000_000;

/**
 * Blocklists a lead for one client, posted by a form or booking tool (directly or through Zapier/Make)
 * when someone fills in a form or books a meeting. The tool is unknown, so the email and website are
 * looked for in the body (JSON or form fields). Query options:
 * - `reason`: a suppression reason, default `form_submitted` (`meeting_booked` for booking tools)
 * - `block`: `both` (default: the email and the whole company), `email` or `domain`
 * - `days`: expire the entries after this many days; default never
 * - `source`: free text kept with the entries, e.g. `calendly`
 */
export async function POST(request: Request, { params }: { params: Promise<{ clientToken: string }> }) {
  const { clientToken } = await params;
  const db = getDb();

  // Compare against every client's token in constant time rather than looking the token up by value.
  const candidates = await db
    .select({ id: clients.id, token: clients.blocklistToken, settings: clients.settings })
    .from(clients)
    .where(isNotNull(clients.blocklistToken));
  let client: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (candidate.token && constantTimeEqual(clientToken, candidate.token)) client = candidate;
  }
  if (!client) return Response.json({ ok: false, error: "unknown token" }, { status: 404 });

  const url = new URL(request.url);
  const reason = (url.searchParams.get("reason")?.trim().toLowerCase() || "form_submitted") as SuppressionReason;
  if (!SUPPRESSION_REASONS.includes(reason)) {
    return Response.json({ ok: false, error: `reason must be one of ${SUPPRESSION_REASONS.join(", ")}` }, { status: 400 });
  }
  const scope = (url.searchParams.get("block")?.trim().toLowerCase() || "both") as BlocklistScope;
  if (!BLOCKLIST_SCOPES.includes(scope)) {
    return Response.json({ ok: false, error: `block must be one of ${BLOCKLIST_SCOPES.join(", ")}` }, { status: 400 });
  }
  const days = Number(url.searchParams.get("days") ?? 0);
  if (!Number.isFinite(days) || days < 0) return Response.json({ ok: false, error: "days must be a positive number" }, { status: 400 });
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;

  const contentType = request.headers.get("content-type");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "payload too large" }, { status: 413 });
  }
  let payload: unknown;
  if (contentType?.toLowerCase().includes("multipart/form-data")) {
    const form = await request.formData().catch(() => undefined);
    payload = form && Object.fromEntries([...form].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } else {
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return Response.json({ ok: false, error: "payload too large" }, { status: 413 });
    payload = parseBody(text, contentType);
  }
  if (payload === undefined) return Response.json({ ok: false, error: "body must be JSON or form fields" }, { status: 400 });

  const settings = parseClientSettings(client.settings);
  const contact = parseBlocklistPayload(payload);
  // A form on the client's own site can carry the client's own domain; never blocklist that.
  if (contact.domain && domainInList(contact.domain, settings.ownDomains)) contact.domain = undefined;
  const entries = blocklistEntries(contact, scope, settings.freeEmailDomains);
  if (entries.length === 0) {
    const fields = payload && typeof payload === "object" ? Object.keys(payload).slice(0, 30) : [];
    logger.warn({ clientId: client.id, fields }, "blocklist webhook without an email or website");
    // 422 so the sending tool shows it as failed and the mapping can be fixed.
    return Response.json({ ok: false, error: "no email or website found in the body", fields }, { status: 422 });
  }

  const note = [url.searchParams.get("source")?.trim(), eventName(payload)].filter(Boolean).join(" · ") || null;
  const { suppressedLeads } = await addToBlocklist(db, { clientId: client.id, entries, reason, source: "webhook", expiresAt, note });
  logger.info({ clientId: client.id, entries, reason, suppressedLeads }, "blocklist webhook accepted");
  return Response.json({ ok: true, blocked: entries, reason, suppressedLeads });
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!text.trim()) return {};
  const type = contentType?.toLowerCase() ?? "";
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  try {
    return JSON.parse(text);
  } catch {
    // Some tools send form fields without the content type.
    return type.includes("json") || !text.includes("=") ? undefined : Object.fromEntries(new URLSearchParams(text));
  }
}

/** The tool's event name, if it sends one (`invitee.created`, `BOOKING_CREATED`, `form_response`, …). */
function eventName(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const value = record.event ?? record.event_type ?? record.triggerEvent ?? record.type;
  return typeof value === "string" ? value.slice(0, 100) : undefined;
}
