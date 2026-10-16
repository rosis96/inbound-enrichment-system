"use server";

import { getDb, inArray, leads } from "@enrich/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { enqueueNormalise } from "@/lib/queue";

const MAX_BULK = 200;

/** Re-runs the whole chain for each ticked lead, as Reprocess on a lead does; leads already in Instantly get their variables updated. */
export async function reprocessLeads(formData: FormData): Promise<void> {
  await requireAdmin();
  const back = String(formData.get("back") ?? "/leads");
  const ids = [...new Set(formData.getAll("leadId").map(String))].slice(0, MAX_BULK);
  const backTo = (params: string) => redirect(`${back}${back.includes("?") ? "&" : "?"}${params}`);
  if (ids.length === 0) backTo("bulk=none");

  const rows = await getDb().select({ rawEventId: leads.rawEventId }).from(leads).where(inArray(leads.id, ids));
  for (const row of rows) await enqueueNormalise({ rawEventId: row.rawEventId, force: true });
  revalidatePath("/leads");
  backTo(`bulk=${rows.length}`);
}
