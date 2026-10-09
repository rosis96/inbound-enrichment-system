import { loadRootEnvFile } from "@enrich/shared/env";
import { defineConfig } from "drizzle-kit";

loadRootEnvFile();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
