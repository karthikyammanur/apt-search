// Run with: npm run db:seed            (keeps existing rows)
//           npm run db:seed -- --overwrite   (re-reads settings from the config file)
// Prints which file was used and row counts, never the values.

import path from "node:path";
import { createDb } from "./index";
import { seedDatabase } from "./seeding";

async function main() {
  const overwrite = process.argv.includes("--overwrite");
  const result = await seedDatabase(createDb(), {
    configDir: path.join(process.cwd(), "config"),
    overwrite,
  });
  console.log(
    `Seeded from ${result.file}: ${result.settingsWritten} settings, ${result.weightsWritten} starting weights written.`,
  );
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
