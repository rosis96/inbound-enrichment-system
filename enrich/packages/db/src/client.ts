import { getEnv } from "@enrich/shared/env";
import { sql } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export type Database = MySql2Database<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type Executor = Database | Transaction;

export interface DbHandle {
  db: Database;
  pool: mysql.Pool;
}

export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = mysql.createPool({ uri: connectionString, connectionLimit: options.max ?? 10, charset: "utf8mb4" });
  return { db: drizzle(pool, { schema, mode: "default" }), pool };
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
