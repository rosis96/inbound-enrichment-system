import { sql } from "drizzle-orm";
import { check, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { id, timestamps } from "./_shared";

/** Admin UI logins. Seeded from ADMIN_EMAIL / ADMIN_PASSWORD by `pnpm db:seed`. */
export const adminUsers = mysqlTable(
  "admin_users",
  {
    id: id(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 100 }).notNull(),
    ...timestamps(),
  },
  (t) => [check("admin_users_email_lowercase", sql`${t.email} = lower(${t.email})`)],
);
