import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { json, timestamps } from "./_shared";

/** App-wide settings edited in the admin UI, one row per key (e.g. "integrations"). */
export const appSettings = mysqlTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: json("value").$type<unknown>().notNull(),
  ...timestamps(),
});
