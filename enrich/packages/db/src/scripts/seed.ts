import { generateToken } from "@enrich/shared/crypto";
import { hashPassword } from "@enrich/shared/password";
import { getEnv, loadRootEnvFile } from "@enrich/shared/env";
import { PROMPT_KEYS } from "@enrich/shared";
import { count, eq, isNull, sql } from "drizzle-orm";
import { createDb } from "../client";
import { adminUsers, clients, prompts, suppression } from "../schema";
import { DEMO_CLIENT_SLUG, demoSettings, demoSuppression, promptsV1 } from "../seed-data";

loadRootEnvFile();
const env = getEnv();
const { db, pool } = createDb(env.DATABASE_URL, { max: 1 });

try {
  await db.transaction(async (tx) => {
    await tx
      .insert(prompts)
      .values(PROMPT_KEYS.map((key) => ({ key, version: 1, template: promptsV1[key], model: null, active: true })))
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
    console.log(`Seeded prompt v1 for ${PROMPT_KEYS.join(", ")}`);

    // The demo client is only for an empty install: the seed runs on every deploy, and a demo client
    // deleted on the Clients page must stay deleted.
    const [{ existing } = { existing: 0 }] = await tx.select({ existing: count() }).from(clients);
    if (existing > 0) {
      console.log(`Skipped demo client: ${existing} client(s) already exist`);
      return;
    }

    await tx
      .insert(clients)
      .values({
        name: "Demo Client",
        slug: DEMO_CLIENT_SLUG,
        dryRun: true,
        autoApprove: false,
        happierleadsToken: generateToken(),
        instantlyWebhookToken: generateToken(),
        blocklistToken: generateToken(),
        settings: demoSettings,
        monthlyBudgetUsd: 50,
      })
      // Keep an existing demo client (and its tokens) untouched.
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });

    const [client] = await tx.select().from(clients).where(eq(clients.slug, DEMO_CLIENT_SLUG));
    if (!client) throw new Error("demo client missing after insert");

    await tx
      .insert(suppression)
      .values(demoSuppression.map((row) => ({ ...row, clientId: client.id, source: "manual" as const })))
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });

    console.log(`Seeded client "${client.name}" (${client.slug}), dry run: ${client.dryRun}, with ${demoSuppression.length} suppression rows`);
    console.log(`  Happierleads webhook: ${env.APP_URL}/api/hooks/happierleads/${client.happierleadsToken}`);
    console.log(`  Instantly webhook:    ${env.APP_URL}/api/hooks/instantly/${client.instantlyWebhookToken}`);
  });

  // Clients created before the blocklist webhook existed get their token here.
  const withoutToken = await db.select({ id: clients.id }).from(clients).where(isNull(clients.blocklistToken));
  for (const { id } of withoutToken) {
    await db.update(clients).set({ blocklistToken: generateToken() }).where(eq(clients.id, id));
  }
  if (withoutToken.length > 0) console.log(`Added a blocklist webhook token to ${withoutToken.length} client(s)`);

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    // Re-hashing on every seed lets ADMIN_PASSWORD be rotated by re-running the seed.
    const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
    await db
      .insert(adminUsers)
      .values({ email: env.ADMIN_EMAIL, passwordHash })
      .onDuplicateKeyUpdate({ set: { passwordHash } });
    console.log(`Seeded superadmin ${env.ADMIN_EMAIL}`);
  } else {
    console.log("Skipped superadmin: set ADMIN_EMAIL and ADMIN_PASSWORD in .env to create the admin login");
  }
} finally {
  await pool.end();
}
