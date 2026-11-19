import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db";
import { SOFT_FACTORS, STARTING_WEIGHT } from "@/db/defaults";
import { runMigrations } from "@/db/run-migrations";
import { facts, listings, PROVENANCE, preferences, settings } from "@/db/schema";
import { seedDatabase } from "@/db/seeding";
import { getSettings, setSetting } from "@/db/settings";
import { settingsSchema } from "@/db/settings-schema";
import { repoRoot } from "./rules";

const EXAMPLE = path.join(repoRoot, "config", "settings.example.json");

/** A config dir holding only the example file, so these tests never touch a local settings file. */
function exampleConfigDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "af-config-"));
  copyFileSync(EXAMPLE, path.join(dir, "settings.example.json"));
  return dir;
}

describe("guard: every fact has a provenance (AGENTS.md rule 2)", () => {
  it("facts.provenance is a required column limited to the five allowed values", () => {
    expect(facts.provenance.notNull).toBe(true);
    expect(facts.provenance.enumValues).toEqual(["listing", "landlord", "estimate", "api", "me"]);
    expect([...PROVENANCE]).toEqual(["listing", "landlord", "estimate", "api", "me"]);
  });

  it("the database refuses a fact row with no provenance", async () => {
    const db = createDb(":memory:");
    await runMigrations(db);
    await db.insert(listings).values({ source: "test", firstSeen: "2026-11-19" });
    await expect(
      db.run(
        sql`insert into facts (listing_id, field, checked_at) values (1, 'rent', '2026-11-19')`,
      ),
    ).rejects.toThrow();
  });
});

describe("settings and seed", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb(":memory:");
    await runMigrations(db);
  });

  it("the example settings file passes the shared Zod schema", () => {
    const raw: unknown = JSON.parse(readFileSync(EXAMPLE, "utf8"));
    expect(settingsSchema.safeParse(raw).success).toBe(true);
  });

  it("seeds settings and equal starting weights on a fresh database", async () => {
    const result = await seedDatabase(db, { configDir: exampleConfigDir() });
    expect(result).toMatchObject({
      file: "settings.example.json",
      settingsWritten: 11,
      weightsWritten: SOFT_FACTORS.length,
    });

    const expected: unknown = JSON.parse(readFileSync(EXAMPLE, "utf8"));
    expect(await getSettings(db)).toEqual(expected);

    const weights = await db.select().from(preferences);
    expect(weights.map((row) => row.key).sort()).toEqual([...SOFT_FACTORS].sort());
    for (const row of weights) {
      expect(row.kind).toBe("soft");
      expect(row.weight).toBeCloseTo(STARTING_WEIGHT, 10);
    }
    expect(weights.reduce((total, row) => total + (row.weight ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it("re-seeding keeps edits unless --overwrite is asked for", async () => {
    const configDir = exampleConfigDir();
    await seedDatabase(db, { configDir });
    await setSetting(db, "budgetCapCents", 123400);

    const again = await seedDatabase(db, { configDir });
    expect(again).toMatchObject({ settingsWritten: 0, weightsWritten: 0 });
    expect((await getSettings(db)).budgetCapCents).toBe(123400);

    await seedDatabase(db, { configDir, overwrite: true });
    expect((await getSettings(db)).budgetCapCents).toBe(250000);
  });

  it("rejects an invalid write and an invalid stored row", async () => {
    await seedDatabase(db, { configDir: exampleConfigDir() });
    await expect(setSetting(db, "budgetCapCents", -5)).rejects.toThrow();
    await expect(setSetting(db, "startDate", "not-a-date")).rejects.toThrow();

    await db
      .update(settings)
      .set({ value: "oops" })
      .where(sql`key = 'budgetCapCents'`);
    await expect(getSettings(db)).rejects.toThrow();
  });
});
