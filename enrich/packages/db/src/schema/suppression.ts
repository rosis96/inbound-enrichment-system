import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";
import { clients } from "./clients";
import { suppressionKind, suppressionReason, suppressionSource } from "./enums";

export const suppression = pgTable(
  "suppression",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: suppressionKind("kind").notNull(),
    value: text("value").notNull(),
    reason: suppressionReason("reason").notNull(),
    source: suppressionSource("source").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("suppression_client_kind_value_unique").on(t.clientId, t.kind, t.value),
    check("suppression_value_lowercase", sql`${t.value} = lower(${t.value})`),
  ],
);
