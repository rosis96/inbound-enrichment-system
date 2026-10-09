import { getEnv } from "@enrich/shared/env";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type Executor = Database | Transaction;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
}

export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return { db: drizzle(pool, { schema }), pool };
}

const globalForDb = globalThis as typeof globalThis & { __enrichDb?: DbHandle };

/** Process-wide handle from DATABASE_URL; survives Next.js dev hot reloads. */
export function getDb(): Database {
  globalForDb.__enrichDb ??= createDb(getEnv().DATABASE_URL);
  return globalForDb.__enrichDb.db;
}

export async function checkDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
