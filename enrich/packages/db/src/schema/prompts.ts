import { boolean, int, mysqlTable, text, unique, varchar } from "drizzle-orm/mysql-core";
import { id, timestamps } from "./_shared";
import { promptKey } from "./enums";

export const prompts = mysqlTable(
  "prompts",
  {
    id: id(),
    key: promptKey("key").notNull(),
    version: int("version").notNull(),
    template: text("template").notNull(),
    // Null means "use OPENAI_MODEL from env".
    model: varchar("model", { length: 100 }),
    active: boolean("active").notNull().default(false),
    ...timestamps(),
  },
  (t) => [unique("prompts_key_version_unique").on(t.key, t.version)],
);
