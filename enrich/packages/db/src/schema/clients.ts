import type { ClientSettingsInput } from "@enrich/shared";
import { boolean, decimal, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { id, json, timestamps } from "./_shared";
import { clientStatus } from "./enums";

export const clients = mysqlTable("clients", {
  id: id(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  status: clientStatus("status").notNull().default("active"),
  dryRun: boolean("dry_run").notNull().default(true),
  autoApprove: boolean("auto_approve").notNull().default(false),
  happierleadsToken: varchar("happierleads_token", { length: 64 }).notNull().unique(),
  instantlyWebhookToken: varchar("instantly_webhook_token", { length: 64 }).notNull().unique(),
  // AES-256-GCM, `iv:tag:ciphertext`. Decrypted only in the worker at push time.
  instantlyApiKeyEnc: varchar("instantly_api_key_enc", { length: 1024 }),
  // Always read through parseClientSettings() so defaults apply.
  settings: json("settings")
    .$type<ClientSettingsInput>()
    .notNull()
    .$defaultFn(() => ({})),
  monthlyBudgetUsd: decimal("monthly_budget_usd", { precision: 12, scale: 2, mode: "number" }),
  ...timestamps(),
});
