import { checkDatabase, getDb } from "@enrich/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await checkDatabase(getDb());
    return Response.json({ ok: true, db: "ok" });
  } catch {
    return Response.json({ ok: false, db: "unreachable" }, { status: 503 });
  }
}
