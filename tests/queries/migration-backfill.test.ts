// Migration 0002 adds enrichment.bucket and enrichment.score and fills them from the versioned
// envelope step 5 stored in cost_breakdown. Build a database at migration 0001, write rows the
// way step 5 did, then apply the rest and check every analyzed row has a bucket.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { runMigrations } from "@/db/run-migrations";
import { enrichment, listings } from "@/db/schema";
import { readAnalysis } from "@/lib/intake/analysis";

const MIGRATIONS = path.join(process.cwd(), "src", "db", "migrations");

/** A copy of the migrations folder holding only the first `count` migrations. */
function migrationsUpTo(count: number): string {
  const root = mkdtempSync(path.join(tmpdir(), "af-migrations-"));
  const target = path.join(root, "src", "db", "migrations");
  mkdirSync(path.join(target, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, count);
  for (const entry of journal.entries) cpSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(target, `${entry.tag}.sql`));
  writeFileSync(path.join(target, "meta", "_journal.json"), JSON.stringify(journal));
  return root;
}

const envelope = (bucket: string, score: number | null) => ({
  version: 1,
  bucket,
  cost: { allInMonthlyCents: null, allInPlusTransitCents: null, lines: [] },
  filters: { results: [{ filter: "lease", status: "unknown" }] },
  score: score === null ? null : { score },
  explanation: null,
});

describe("migration 0002 backfill", () => {
  it("gives every analyzed enrichment row its bucket and score, and titles old listings", async () => {
    const db = createDb(":memory:");
    await runMigrations(db, migrationsUpTo(2));
    const rows: [string, unknown][] = [
      ["Room in a sample house\nPrice: $1500", envelope("needs_info", 0)],
      ["Studio (sample)", envelope("pass", 81.5)],
      ["Sublet (sample)", envelope("fail", null)],
      ["Likely (sample)", envelope("likely", 70)],
    ];
    for (const [index, [text, analysis]] of rows.entries()) {
      await db.run(sql`insert into listings (source, raw_text, first_seen) values ('supost', ${text}, '2026-11-24')`);
      await db.run(sql`insert into enrichment (listing_id, cost_breakdown, computed_at) values (${index + 1}, ${JSON.stringify(analysis)}, '2026-11-24')`);
    }

    await runMigrations(db);

    const saved = await db.select().from(enrichment).orderBy(enrichment.listingId);
    expect(saved.map((r) => [r.bucket, r.score])).toEqual([
      ["needs_info", 0],
      ["pass", 81.5],
      ["fail", null],
      ["likely", 70],
    ]);
    expect(saved.every((r) => r.bucket !== null)).toBe(true);
    // Old rows still read through the envelope.
    expect(saved.every((r) => readAnalysis(r.costBreakdown) !== null)).toBe(true);
    const titled = await db.select({ title: listings.title, userStatus: listings.userStatus }).from(listings).orderBy(listings.id);
    expect(titled[0]).toEqual({ title: "Room in a sample house", userStatus: "none" });
  });
});
