import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

export const DEFAULT_DATABASE_URL = "file:data/dev.db";

type Env = Record<string, string | undefined>;

/** True on a Vercel deployment (production or preview), false on a laptop or after a Vercel dev pull. */
function onVercelDeployment(env: Env): boolean {
  return Boolean(env.VERCEL) && env.VERCEL_ENV !== "development";
}

/**
 * Which database to open. DATABASE_URL and DATABASE_AUTH_TOKEN win everywhere, so scripts and tests
 * can always point somewhere explicit. The Vercel Turso integration creates TURSO_DATABASE_URL and
 * TURSO_AUTH_TOKEN instead; those are read only on a Vercel deployment, so a `vercel env pull` into
 * .env.local can never aim local `next dev` at the production database.
 */
export function resolveDatabaseConfig(env: Env = process.env): { url: string; authToken: string | undefined } {
  const vercel = onVercelDeployment(env);
  const url = env.DATABASE_URL || (vercel ? env.TURSO_DATABASE_URL : undefined) || DEFAULT_DATABASE_URL;
  const authToken = env.DATABASE_AUTH_TOKEN || (vercel ? env.TURSO_AUTH_TOKEN : undefined) || undefined;
  return { url, authToken };
}

/** Where a URL points, without credentials or query string: "file:data/dev.db" or "libsql://host". */
export function describeDatabaseTarget(url: string): string {
  if (url.startsWith("file:")) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "an unparseable URL";
  }
}

/**
 * Open the database. Local dev uses a SQLite file; production uses Turso (see resolveDatabaseConfig).
 * Pass an explicit url (for example ":memory:") in tests.
 */
export function createDb(
  url: string = resolveDatabaseConfig().url,
  authToken: string | undefined = resolveDatabaseConfig().authToken,
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
