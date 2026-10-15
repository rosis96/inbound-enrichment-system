"use server";

import { and, clients, eq, getDb, leads, rawEvents } from "@enrich/db";
import { ClientSettings } from "@enrich/shared";
import { generateToken } from "@enrich/shared/crypto";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/** "https://www.Acme.com/about" → "acme.com" */
function toDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0]!;
}

function fail(message: string): never {
  redirect(`/clients?error=${encodeURIComponent(message)}`);
}

/** Creates a client in dry run with default settings and fresh webhook tokens. */
export async function createClient(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "").trim() || name);
  const domains = String(formData.get("ownDomains") ?? "")
    .split(/[\n,]/)
    .map(toDomain)
    .filter(Boolean);

  if (!name) fail("Name is required");
  if (name.length > 255) fail("Name is too long");
  if (!slug) fail("Slug needs at least one letter or digit");

  const db = getDb();
  const [taken] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug));
  if (taken) fail(`Slug "${slug}" is already used`);

  const id = randomUUID();
  await db.insert(clients).values({
    id,
    name,
    slug,
    dryRun: true,
    happierleadsToken: generateToken(),
    instantlyWebhookToken: generateToken(),
    settings: ClientSettings.parse({ ownDomains: domains }),
  });

  revalidatePath("/clients");
  redirect(`/settings?client=${id}&created=1`);
}

/**
 * Permanently deletes a client with its leads, contacts, webhook events, suppression list and lab tests.
 * The client's name must be typed to confirm. Companies are shared, so they stay.
 */
export async function deleteClient(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("clientId") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  const db = getDb();
  const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, id));
  if (!client) fail("Client not found");
  if (confirm !== client.name) fail(`Type "${client.name}" exactly to delete it`);

  await db.transaction(async (tx) => {
    // Leads first: they point at webhook events without a cascade, so the client's cascade could stop on them.
    await tx.delete(leads).where(eq(leads.clientId, client.id));
    await tx.delete(clients).where(eq(clients.id, client.id));
  });

  revalidatePath("/clients");
  redirect(`/clients?deleted=${encodeURIComponent(client.name)}`);
}

/**
 * Permanently deletes a client's leads with their contacts, pipeline steps and Happierleads webhook events.
 * The client, its settings, suppression list and lab tests stay. The client's name must be typed to confirm.
 */
export async function deleteClientLeads(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("clientId") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  const db = getDb();
  const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, id));
  if (!client) fail("Client not found");
  if (confirm !== client.name) fail(`Type "${client.name}" exactly to delete its leads`);

  await db.transaction(async (tx) => {
    // Leads first: they point at the webhook events without a cascade.
    await tx.delete(leads).where(eq(leads.clientId, client.id));
    await tx.delete(rawEvents).where(and(eq(rawEvents.clientId, client.id), eq(rawEvents.source, "happierleads")));
  });

  revalidatePath("/clients");
  revalidatePath("/leads");
  redirect(`/clients?leadsDeleted=${encodeURIComponent(client.name)}`);
}
