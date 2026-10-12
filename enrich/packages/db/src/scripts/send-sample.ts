/**
 * Posts a sample Happierleads payload to the local webhook.
 *
 *   pnpm sample:happierleads            # high-fit sample (expect dry_run_complete)
 *   pnpm sample:happierleads low        # low-fit sample (expect below_icp)
 *   pnpm sample:happierleads high --fresh   # random domain, so the dedupe gate does not catch a repeat
 *   pnpm sample:happierleads path/to/payload.json --client demo
 */
import { getEnv, loadRootEnvFile } from "@enrich/shared/env";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "../client";
import { clients } from "../schema";
import { DEMO_CLIENT_SLUG } from "../seed-data";

loadRootEnvFile();
const env = getEnv();

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const positional = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--client"));
const sample = positional[0] ?? "high";
const slug = option("client") ?? DEMO_CLIENT_SLUG;

const samplesDir = fileURLToPath(new URL("../../../../scripts/samples/", import.meta.url));
const file = existsSync(sample) ? sample : `${samplesDir}happierleads-${sample}.json`;
if (!existsSync(file)) {
  console.error(`No sample "${sample}". Use high, low or a path to a JSON file.`);
  process.exit(1);
}
let body = readFileSync(file, "utf8");
if (flag("fresh")) {
  // Prefix the company domain so this visit is a new company for the dedupe gate.
  const payload = JSON.parse(body) as { company?: { domain?: string } };
  if (payload.company?.domain) {
    const domain = payload.company.domain.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    payload.company.domain = `${randomBytes(3).toString("hex")}-${domain}`;
    body = JSON.stringify(payload);
  }
}

const { db, pool } = createDb(env.DATABASE_URL, { max: 1 });
const [client] = await db.select().from(clients).where(eq(clients.slug, slug));
await pool.end();
if (!client) {
  console.error(`Client "${slug}" not found. Run pnpm db:seed first.`);
  process.exit(1);
}

const url = `${env.APP_URL}/api/hooks/happierleads/${client.happierleadsToken}`;
console.log(`POST ${env.APP_URL}/api/hooks/happierleads/<${slug} token>  (${file})`);
const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
console.log(response.status, await response.text());
if (!response.ok) process.exit(1);
console.log(`Open ${env.APP_URL}/leads to follow it through the pipeline.`);
