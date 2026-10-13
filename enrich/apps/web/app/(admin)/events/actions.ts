"use server";

import { eq, getDb, rawEvents } from "@enrich/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { enqueueNormalise } from "@/lib/queue";

/** Runs a stored payload through the pipeline again, e.g. after the parser was fixed. */
export async function reprocessEvent(formData: FormData): Promise<void> {
  await requireAdmin();
  const eventId = String(formData.get("eventId") ?? "");
  const [event] = await getDb().select({ id: rawEvents.id }).from(rawEvents).where(eq(rawEvents.id, eventId));
  if (!event) redirect("/events");
  await getDb().update(rawEvents).set({ error: null }).where(eq(rawEvents.id, event.id));
  await enqueueNormalise({ rawEventId: event.id, force: true });
  revalidatePath("/events");
  redirect("/events?queued=1");
}
