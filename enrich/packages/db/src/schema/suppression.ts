import { sql } from "drizzle-orm";
import { check, index, mysqlTable, text, unique, varchar } from "drizzle-orm/mysql-core";
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
    // Where a webhook entry came from, e.g. the form or booking tool's event.
    note: varchar("note", { length: 500 }),
    // Copy in Instantly's blocklist: its id once created; last attempt and error otherwise.
    instantlyEntryId: varchar("instantly_entry_id", { length: 64 }),
    instantlyCheckedAt: utcDatetime("instantly_checked_at"),
    instantlyError: text("instantly_error"),
    ...timestamps(),
  },
  (t) => [
    unique("suppression_client_kind_value_unique").on(t.clientId, t.kind, t.value),
    index("suppression_client_instantly_idx").on(t.clientId, t.instantlyEntryId),
    check("suppression_value_lowercase", sql`${t.value} = lower(${t.value})`),
  ],
);
