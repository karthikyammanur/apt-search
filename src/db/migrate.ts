// Run with: npm run db:migrate
// Uses DATABASE_URL (default file:data/dev.db) and DATABASE_AUTH_TOKEN from the shell.
// It does not read .env.local, see SETUP.md for pointing it at Turso.

import { createDb } from "./index";
import { runMigrations } from "./run-migrations";

async function main() {
  await runMigrations(createDb());
  console.log("Migrations applied.");
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
