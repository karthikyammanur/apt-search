import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db";
import { PROVENANCE_PRIORITY, pickCurrentFact } from "@/db/facts";
import { facts, listings, type Provenance } from "@/db/schema";

type Row = { value: unknown; provenance: Provenance; checkedAt: string };
const row = (provenance: Provenance, value: unknown, checkedAt = "2026-11-19T10:00:00Z"): Row => ({
  value,
  provenance,
  checkedAt,
});

describe("pickCurrentFact: priority landlord, me, listing, api, estimate", () => {
  it("lists the five provenance values in that order", () => {
    expect([...PROVENANCE_PRIORITY]).toEqual(["landlord", "me", "listing", "api", "estimate"]);
  });

  it("every source beats every lower one, whatever order the rows arrive in", () => {
    for (let high = 0; high < PROVENANCE_PRIORITY.length; high += 1) {
      for (let low = high + 1; low < PROVENANCE_PRIORITY.length; low += 1) {
        const winner = PROVENANCE_PRIORITY[high] as Provenance;
        const loser = PROVENANCE_PRIORITY[low] as Provenance;
        const a = row(winner, "win");
        const b = row(loser, "lose");
        expect(pickCurrentFact([a, b])).toBe(a);
        expect(pickCurrentFact([b, a])).toBe(a);
      }
    }
  });

  it("a landlord answer wins over what the listing said", () => {
    const listing = row("listing", 240000);
    const landlord = row("landlord", 230000);
    expect(pickCurrentFact([listing, landlord])?.value).toBe(230000);
  });

  it("skips unknown (null) values so they never override a known one", () => {
    const landlordUnknown = row("landlord", null);
    const listing = row("listing", true);
    expect(pickCurrentFact([landlordUnknown, listing])).toBe(listing);
  });

  it("keeps false and 0 as real values", () => {
    expect(pickCurrentFact([row("listing", false)])?.value).toBe(false);
    expect(pickCurrentFact([row("estimate", 0)])?.value).toBe(0);
  });

  it("returns null for no rows, or when every value is unknown", () => {
    expect(pickCurrentFact([])).toBeNull();
    expect(pickCurrentFact([row("listing", null), row("me", null)])).toBeNull();
  });

  it("breaks a tie on the same source by the latest check", () => {
    const older = row("listing", "old", "2026-11-18T10:00:00Z");
    const newer = row("listing", "new", "2026-11-19T10:00:00Z");
    expect(pickCurrentFact([newer, older])).toBe(newer);
    expect(pickCurrentFact([older, newer])).toBe(newer);
  });
});

describe("facts table: one row per source of truth", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb(":memory:");
    const { runMigrations } = await import("@/db/run-migrations");
    await runMigrations(db);
    await db.insert(listings).values({ source: "test", firstSeen: "2026-11-19" });
  });

  const fact = (provenance: Provenance, value: unknown) => ({
    listingId: 1,
    field: "rent",
    value,
    provenance,
    checkedAt: "2026-11-19T10:00:00Z",
  });

  it("keeps the listing's value and the landlord's answer side by side", async () => {
    await db.insert(facts).values(fact("listing", 240000));
    await db.insert(facts).values(fact("landlord", 230000));

    const rows = await db.select().from(facts);
    expect(rows).toHaveLength(2);
    expect(pickCurrentFact(rows)?.provenance).toBe("landlord");
    expect(pickCurrentFact(rows)?.value).toBe(230000);
  });

  it("rejects a second row for the same listing, field and source", async () => {
    await db.insert(facts).values(fact("listing", 240000));
    await expect(db.insert(facts).values(fact("listing", 250000))).rejects.toThrow();
  });
});
