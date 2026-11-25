// A post is saved in one transaction, and counts as seen only once all of it is saved. A post cut off at the
// time limit, or one that fails halfway, leaves nothing behind, so the next run starts it again instead of
// treating it as already seen.

import { describe, expect, it } from "vitest";
import { enrichment, facts, listings, photos } from "@/db/schema";
import { captureToRaw, pageSchema } from "@/lib/intake/capture";
import { processBatch, startBudget } from "@/lib/intake/budget";
import { processRaw } from "@/lib/intake/pipeline";
import type { RawListing } from "@/lib/intake/types";
import { FIXTURE_REPLIES, jsonFixture, makeDeps } from "./helpers";

const pageRaw = (): RawListing => ({
  ...(captureToRaw(pageSchema.parse(jsonFixture("extension-page.json")))[0] as RawListing),
  photoUrls: ["https://images.example.test/a.jpg", "https://images.example.test/b.jpg"],
  photoHashes: [],
});

const counts = async (db: Awaited<ReturnType<typeof makeDeps>>["db"]) => ({
  listings: (await db.select().from(listings)).length,
  facts: (await db.select().from(facts)).length,
  photos: (await db.select().from(photos)).length,
  enrichment: (await db.select().from(enrichment)).length,
});

describe("a post cut off at the time limit", () => {
  it("is not stored, so the next run does the post again rather than calling it already seen", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const working = deps.geo;
    // The commute lookup never answers: the post is still waiting on the network when the budget ends.
    deps.geo = { ...working, transit: () => new Promise(() => {}) };

    const budget = startBudget({ maxWork: 10, startWithinMs: 60_000, stopWithinMs: 40 });
    const cut = await processBatch(deps, [pageRaw()], 10, budget);
    expect(cut.gaveUp).toBe(true);
    expect(cut.leftover).toHaveLength(1);
    expect(await counts(db)).toEqual({ listings: 0, facts: 0, photos: 0, enrichment: 0 });

    // The next run, with the network back, finishes it: stored, not already_seen.
    deps.geo = working;
    deps.memo = {};
    const again = await processRaw(deps, cut.leftover[0]!);
    expect(again.status).toBe("stored");
    const after = await counts(db);
    expect(after.listings).toBe(1);
    expect(after.photos).toBe(2);
    expect(after.enrichment).toBe(1);
    expect(after.facts).toBeGreaterThan(0);
  });
});

describe("a post that fails while being saved", () => {
  it("saves none of it, and is saved whole on the next try", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const working = deps.region;
    // Pricing the pass throws in the last step, after the listing, its facts and its photos were written.
    deps.region = {
      ...working,
      cheapestPass: () => {
        throw new Error("boom");
      },
    };
    const first = await processRaw(deps, pageRaw());
    expect(first.status).toBe("error");
    expect(await counts(db)).toEqual({ listings: 0, facts: 0, photos: 0, enrichment: 0 });

    deps.region = working;
    const second = await processRaw(deps, pageRaw());
    expect(second.status).toBe("stored");
    expect((await counts(db)).listings).toBe(1);
    // And once stored, it is seen: a third look is free.
    expect((await processRaw(deps, pageRaw())).status).toBe("already_seen");
  });

  it("does the same for a duplicate that merges into a saved listing", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    expect((await processRaw(deps, pageRaw())).status).toBe("stored");
    const before = await counts(db);
    // Nothing new is learned from the same post under another link, so the listing's rows do not change.
    const sameAgain = { ...pageRaw(), url: "https://example.test/another-link" };
    const outcome = await processRaw(deps, sameAgain);
    expect(["merged", "already_seen"]).toContain(outcome.status);
    expect((await counts(db)).listings).toBe(before.listings);
  });
});
