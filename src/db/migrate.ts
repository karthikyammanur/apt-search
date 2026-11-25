// Run with: npm run db:migrate
// Uses DATABASE_URL (default file:data/dev.db) and DATABASE_AUTH_TOKEN from the shell.
// It does not read .env.local, see docs/deploy.md for pointing it at Turso.

import { createDb, describeDatabaseTarget, resolveDatabaseConfig } from "./index";
import { runMigrations } from "./run-migrations";

async function main() {
  console.log(`Migrating ${describeDatabaseTarget(resolveDatabaseConfig().url)}`);
  if (!process.env.DATABASE_URL && process.env.TURSO_DATABASE_URL) {
    console.warn(
      "TURSO_DATABASE_URL is set but ignored outside Vercel. Set DATABASE_URL and DATABASE_AUTH_TOKEN to migrate Turso.",
    );
  }
  await runMigrations(createDb());
  console.log("Migrations applied.");
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
