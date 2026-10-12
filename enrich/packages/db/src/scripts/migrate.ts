import { loadRootEnvFile } from "@enrich/shared/env";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "../client";

loadRootEnvFile();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (add it to the root .env)");
  process.exit(1);
}

const { db, pool } = createDb(url, { max: 1 });
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)) });
  console.log("migrations applied");
} finally {
  await pool.end();
}
