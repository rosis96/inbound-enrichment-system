import type { ClientSettingsInput } from "@enrich/shared";
import { boolean, jsonb, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { clientStatus } from "./enums";

export const clients = pgTable("clients", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: clientStatus("status").notNull().default("active"),
  dryRun: boolean("dry_run").notNull().default(true),
  autoApprove: boolean("auto_approve").notNull().default(false),
  happierleadsToken: text("happierleads_token").notNull().unique(),
  instantlyWebhookToken: text("instantly_webhook_token").notNull().unique(),
  // AES-256-GCM, `iv:tag:ciphertext`. Decrypted only in the worker at push time.
  instantlyApiKeyEnc: text("instantly_api_key_enc"),
  // Always read through parseClientSettings() so defaults apply.
  settings: jsonb("settings").$type<ClientSettingsInput>().notNull().default({}),
  monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 12, scale: 2, mode: "number" }),
  ...timestamps(),
});
