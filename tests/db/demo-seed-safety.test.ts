// The demo seed must never write settings or preferences into a database that has real listings.

import { describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db";
import { seedDemo } from "@/db/demo";
import { runMigrations } from "@/db/run-migrations";
import { listings, preferences, settings } from "@/db/schema";

const NOW = new Date("2026-12-01T16:00:00Z");
const STAMP = "2026-11-01T00:00:00.000Z";

async function freshDb(): Promise<Db> {
  const db = createDb(":memory:");
  await runMigrations(db);
  return db;
}

const snapshot = async (db: Db) => ({
  settings: await db.select().from(settings),
  preferences: await db.select().from(preferences),
  listings: await db.select().from(listings),
});

async function withRealData(db: Db) {
  await db.insert(settings).values([
    { key: "moveInEarliest", value: "2027-01-02", updatedAt: STAMP },
    { key: "budgetCapCents", value: 175000, updatedAt: STAMP },
  ]);
  await db.insert(preferences).values({ key: "commute", kind: "soft", value: null, weight: 0.4, setBy: "me" });
  await db.insert(listings).values({ source: "supost", url: "https://supost.com/post/index/1", firstSeen: STAMP });
}

describe("the demo seed next to real listings", () => {
  it.each([false, true])("refuses, changes nothing, with reset %s", async (reset) => {
    const db = await freshDb();
    await withRealData(db);
    const before = await snapshot(db);
    await expect(seedDemo(db, { now: NOW, reset })).rejects.toThrow(/real listings/);
    expect(await snapshot(db)).toEqual(before);
  });

  it("refuses when one real listing sits among demo ones", async () => {
    const db = await freshDb();
    await seedDemo(db, { now: NOW });
    await db.insert(listings).values({ source: "supost", url: "https://supost.com/post/index/2", firstSeen: STAMP });
    const before = await snapshot(db);
    await expect(seedDemo(db, { now: NOW, reset: true })).rejects.toThrow(/real listings/);
    expect(await snapshot(db)).toEqual(before);
  });

  it("refuses a real listing that has no URL", async () => {
    const db = await freshDb();
    await db.insert(listings).values({ source: "facebook_group", url: null, firstSeen: STAMP });
    await expect(seedDemo(db, { now: NOW, reset: true })).rejects.toThrow(/real listings/);
  });

  it("still resets a database that holds only demo listings", async () => {
    const db = await freshDb();
    await seedDemo(db, { now: NOW });
    await expect(seedDemo(db, { now: NOW, reset: true })).resolves.toMatchObject({ listings: 12 });
  });

  it("does not overwrite a setting that is already there when there are no listings", async () => {
    const db = await freshDb();
    await db.insert(settings).values({ key: "budgetCapCents", value: 175000, updatedAt: STAMP });
    await seedDemo(db, { now: NOW });
    const rows = await db.select().from(settings);
    expect(rows.find((r) => r.key === "budgetCapCents")).toMatchObject({ value: 175000, updatedAt: STAMP });
    expect(rows.length).toBeGreaterThan(2); // the rest were filled in
  });
});

describe("the throwaway test database", () => {
  it("may replace listings a test added, only when the caller says the database is a test's", async () => {
    const db = await freshDb();
    await withRealData(db);
    await expect(seedDemo(db, { now: NOW, reset: true })).rejects.toThrow(/real listings/);
    await seedDemo(db, { now: NOW, reset: true, discardTestListings: true });
    const rows = await db.select().from(listings);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.url?.startsWith("https://example.com/demo-listings/"))).toBe(true);
  });
});
