"use server";

import { eq, getDb, leads } from "@enrich/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { enqueueNormalise } from "@/lib/queue";

/** Re-runs the whole chain from the stored raw payload with the client's current settings. */
export async function reprocessLead(formData: FormData): Promise<void> {
  await requireAdmin();
  const leadId = String(formData.get("leadId") ?? "");
  const [lead] = await getDb().select({ rawEventId: leads.rawEventId }).from(leads).where(eq(leads.id, leadId));
  if (!lead) redirect("/leads");

  await enqueueNormalise({ rawEventId: lead.rawEventId, force: true });
  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}?reprocessed=1`);
}
