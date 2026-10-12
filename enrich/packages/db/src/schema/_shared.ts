import { randomUUID } from "node:crypto";
import { char, customType, datetime } from "drizzle-orm/mysql-core";

/** UUID primary key generated in the app, so inserts know the id without RETURNING. */
export const id = () =>
  char("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID());

/** Column holding another table's UUID. */
export const uuidRef = (name: string) => char(name, { length: 36 });

/** DATETIME(3) holding UTC. Values are written and read as UTC by Drizzle, whatever the server time zone. */
export const utcDatetime = (name: string) => datetime(name, { mode: "date", fsp: 3 });

// Defaults are set in the app rather than with NOW() so they are UTC like every other timestamp.
export const timestamps = () => ({
  createdAt: utcDatetime("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: utcDatetime("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

/**
 * JSON column. MySQL returns JSON already parsed; MariaDB stores JSON as LONGTEXT and returns a string,
 * so parse strings on the way out.
 */
export const json = customType<{ data: unknown; driverData: string }>({
  dataType: () => "json",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => (typeof value === "string" ? JSON.parse(value) : value),
});
