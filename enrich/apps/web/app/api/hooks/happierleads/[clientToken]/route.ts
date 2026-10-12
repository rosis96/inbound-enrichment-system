import { clients, eq, getDb, rawEvents } from "@enrich/db";
import { constantTimeEqual } from "@enrich/shared/crypto";
import { createLogger } from "@enrich/shared/logger";
import { randomUUID } from "node:crypto";
import { enqueueNormalise } from "@/lib/queue";

export const dynamic = "force-dynamic";

const logger = createLogger({ name: "web" });
const MAX_BODY_BYTES = 1_000_000;

export async function POST(request: Request, { params }: { params: Promise<{ clientToken: string }> }) {
  const { clientToken } = await params;
  const db = getDb();

  // Compare against every client's token in constant time rather than looking the token up by value.
  const candidates = await db.select({ id: clients.id, token: clients.happierleadsToken, status: clients.status }).from(clients);
  let client: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (constantTimeEqual(clientToken, candidate.token)) client = candidate;
  }
  if (!client) return Response.json({ ok: false, error: "unknown token" }, { status: 404 });

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return Response.json({ ok: false, error: "payload too large" }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const rawEventId = randomUUID();
  await db.insert(rawEvents).values({ id: rawEventId, clientId: client.id, source: "happierleads", payload: payload ?? {} });

  if (client.status === "paused") {
    await db.update(rawEvents).set({ error: "client paused", processedAt: new Date() }).where(eq(rawEvents.id, rawEventId));
    return Response.json({ ok: true, rawEventId, skipped: "client_paused" });
  }

  try {
    await enqueueNormalise({ rawEventId });
  } catch (error) {
    logger.error({ err: error, rawEventId }, "failed to enqueue lead.normalise");
    await db.update(rawEvents).set({ error: "enqueue failed" }).where(eq(rawEvents.id, rawEventId));
    // Non-2xx so the sender retries.
    return Response.json({ ok: false, error: "could not enqueue" }, { status: 503 });
  }

  logger.info({ clientId: client.id, rawEventId }, "happierleads webhook accepted");
  return Response.json({ ok: true, rawEventId });
}
