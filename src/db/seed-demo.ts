// Run with: npm run db:seed:demo              (writes data/demo.db unless DATABASE_URL is set)
//           npm run db:seed:demo -- --reset   (replaces everything in that database)
// Applies migrations first, so it works on an empty database. Prints counts only.
// Point the app at it with DATABASE_URL=file:data/demo.db npm run dev

import { createDb } from "./index";
import { seedDemo } from "./demo";
import { runMigrations } from "./run-migrations";

export const DEMO_DATABASE_URL = "file:data/demo.db";

async function main() {
  const url = process.env.DATABASE_URL || DEMO_DATABASE_URL;
  const db = createDb(url);
  await runMigrations(db);
  const result = await seedDemo(db, { reset: process.argv.includes("--reset") });
  const buckets = Object.entries(result.buckets)
    .map(([bucket, n]) => `${bucket} ${n}`)
    .join(", ");
  console.log(
    `Demo data written to ${url.startsWith("file:") ? url : "the configured database"}: ${result.listings} listings (${buckets}), ${result.roommateLeads} roommate leads, ${result.channelRuns} channel runs, ${result.transitStops} transit stops.`,
  );
}

main().catch((error: unknown) => {
  console.error("Demo seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
