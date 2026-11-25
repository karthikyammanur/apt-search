// `npm run recheck`: read every stored listing again from its saved text and redo cost, filters and score.
// Nothing new is fetched (no listing source, no map service). It does call the model once per text post,
// which uses free quota. Writes to the configured database, so try it on a copy first:
//
//   npm run recheck -- --db data/copy.db

import { loadEnvConfig } from "@next/env";
import { createDb, describeDatabaseTarget, getDb, resolveDatabaseConfig } from "@/db";
import { fmtCents } from "@/lib/domain";
import { createDeps } from "./deps";
import { recheckListings } from "./recheck";

loadEnvConfig(process.cwd());

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<number> {
  const file = arg("db");
  const target = file ? `file:${file}` : resolveDatabaseConfig().url;
  console.log(`Rechecking ${describeDatabaseTarget(target)}`);
  let deps;
  try {
    deps = await createDeps({ db: file ? createDb(target) : getDb() });
  } catch {
    console.error("Could not read settings. Run npm run db:migrate and npm run db:seed first.");
    return 1;
  }
  const rows = await recheckListings(deps);
  for (const row of rows) {
    const cost = row.allInMonthlyCents === null ? "Unknown" : fmtCents(row.allInMonthlyCents);
    console.log(`\n#${row.id} ${row.source} | ${row.title ?? "Untitled"}`);
    console.log(`  bucket ${row.before ?? "none"} -> ${row.after} | all-in ${cost}`);
    if (row.failReasons.length > 0) console.log(`  fails: ${row.failReasons.join("; ")}`);
    if (row.changed.length > 0) console.log(`  changed: ${row.changed.join(", ")}`);
    console.log(`  still Unknown: ${row.unknowns.length > 0 ? row.unknowns.join(", ") : "nothing"}`);
    if (row.note) console.log(`  note: ${row.note}`);
  }
  console.log(`\n${rows.length} listings rechecked.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("recheck failed:", error instanceof Error ? error.name : "error");
    process.exit(1);
  },
);
