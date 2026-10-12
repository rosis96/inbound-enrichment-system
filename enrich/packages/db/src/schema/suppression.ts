import { sql } from "drizzle-orm";
import { check, mysqlTable, unique, varchar } from "drizzle-orm/mysql-core";
import { id, timestamps, utcDatetime, uuidRef } from "./_shared";
import { clients } from "./clients";
import { suppressionKind, suppressionReason, suppressionSource } from "./enums";

export const suppression = mysqlTable(
  "suppression",
  {
    id: id(),
    clientId: uuidRef("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: suppressionKind("kind").notNull(),
    value: varchar("value", { length: 320 }).notNull(),
    reason: suppressionReason("reason").notNull(),
    source: suppressionSource("source").notNull(),
    expiresAt: utcDatetime("expires_at"),
    ...timestamps(),
  },
  (t) => [
    unique("suppression_client_kind_value_unique").on(t.clientId, t.kind, t.value),
    check("suppression_value_lowercase", sql`${t.value} = lower(${t.value})`),
  ],
);
