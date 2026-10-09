import { boolean, integer, pgTable, text, unique } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { promptKey } from "./enums";

export const prompts = pgTable(
  "prompts",
  {
    id: id(),
    key: promptKey("key").notNull(),
    version: integer("version").notNull(),
    template: text("template").notNull(),
    // Null means "use OPENAI_MODEL from env".
    model: text("model"),
    active: boolean("active").notNull().default(false),
    ...timestamps(),
  },
  (t) => [unique("prompts_key_version_unique").on(t.key, t.version)],
);
