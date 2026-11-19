import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

export const DEFAULT_DATABASE_URL = "file:data/dev.db";

/**
 * Open the database. Local dev uses a SQLite file; production points DATABASE_URL at Turso.
 * Pass an explicit url (for example ":memory:") in tests.
 */
export function createDb(
  url: string = process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  authToken: string | undefined = process.env.DATABASE_AUTH_TOKEN || undefined,
): Db {
  if (url.startsWith("file:") && !url.startsWith("file::memory:")) {
    mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
  }
  return drizzle(createClient({ url, authToken }), { schema });
}

let shared: Db | undefined;

/** Shared connection for the app. */
export function getDb(): Db {
  shared ??= createDb();
  return shared;
}

export * from "./schema";
