"use server";

import { clients, eq, getDb, variableTests } from "@enrich/db";
import { ClientSettings } from "@enrich/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { LabError, retest, startTest, type RetestMode } from "@/lib/variable-lab";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const orNull = (value: string) => value || null;

/** Runs `work` and turns a LabError into an error banner on `back`; other errors propagate. */
async function attempt(back: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof LabError)) throw error;
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
  }
}

export async function startTestAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const clientId = field(formData, "clientId");
  let id = "";
  await attempt(`/variable-lab?client=${clientId}`, async () => {
    id = await startTest({
      clientId,
      website: field(formData, "website"),
      contact: { firstName: orNull(field(formData, "firstName")), lastName: orNull(field(formData, "lastName")), title: orNull(field(formData, "title")) },
      refresh: formData.get("refresh") === "on",
      variable: field(formData, "variable") || undefined,
    });
  });
  redirect(`/variable-lab/${id}`);
}

export async function retestAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const testId = field(formData, "testId");
  const name = field(formData, "name");
  const kind = field(formData, "mode");
  const mode: RetestMode =
    kind === "variable" ? { kind: "variables", names: [name] } : kind === "replan" ? { kind: "replan" } : kind === "refresh" ? { kind: "refresh" } : { kind: "all" };
  await attempt(`/variable-lab/${testId}`, () => retest(testId, mode));
  revalidatePath(`/variable-lab/${testId}`);
  redirect(`/variable-lab/${testId}${name ? `#${name}` : ""}`);
}

/** Saves new instructions to the client's settings, then rewrites that variable and its dependents. */
export async function saveInstructionsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const testId = field(formData, "testId");
  const name = field(formData, "name");
  const instructions = field(formData, "instructions");
  const back = `/variable-lab/${testId}`;
  const db = getDb();
  const [test] = await db.select({ clientId: variableTests.clientId }).from(variableTests).where(eq(variableTests.id, testId));
  if (!test) redirect("/variable-lab");
  const [client] = await db.select().from(clients).where(eq(clients.id, test.clientId));
  if (!client) redirect("/variable-lab");

  const settings = ClientSettings.parse(client.settings ?? {});
  const parsed = ClientSettings.safeParse({
    ...settings,
    aiVariables: settings.aiVariables.map((v) => (v.name === name ? { ...v, instructions } : v)),
  });
  if (!parsed.success) {
    redirect(`${back}?error=${encodeURIComponent(parsed.error.issues.map((i) => i.message).join("; "))}#${name}`);
  }
  await db.update(clients).set({ settings: parsed.data }).where(eq(clients.id, client.id));

  await attempt(back, () => retest(testId, { kind: "variables", names: [name] }));
  revalidatePath(back);
  revalidatePath("/settings");
  redirect(`${back}#${name}`);
}
