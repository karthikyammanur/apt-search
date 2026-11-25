// The run budget: how a hosted run stays inside Vercel Hobby's 300 s function limit.

import { describe, expect, it } from "vitest";
import { maxDuration } from "@/app/api/cron/intake/route";
import { channelRuns } from "@/db/schema";
import { CRON_BUDGET, runAutomaticChannels } from "@/lib/intake/run";
import { FIXTURE_REPLIES, HOME, jsonFixture, makeDeps } from "./helpers";

/** Distinct RentCast records, far enough apart that dedupe keeps them as separate listings. */
function records(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `rc-${i}`,
    formattedAddress: `${100 + i} Budget Way, Menlo Park, CA 94025`,
    latitude: HOME.lat + i * 0.01,
    longitude: HOME.lng + i * 0.01,
    price: 2300 + i * 10,
    propertyType: "Apartment",
    bedrooms: 0,
    bathrooms: 1,
    city: "Menlo Park",
  }));
}

const rentcast = (items: ReturnType<typeof records>, onList?: () => void) => ({
  listings: async () => {
    onList?.();
    return { ok: true as const, data: items };
  },
});

const BUDGET = { maxWork: 100, startWithinMs: 1_000_000, stopWithinMs: 2_000_000 };

describe("the cron budget fits Vercel Hobby", () => {
  it("stops new work and gives up on a post well inside the 300 s function limit", () => {
    expect(maxDuration).toBe(300);
    expect(CRON_BUDGET.startWithinMs).toBeLessThan(CRON_BUDGET.stopWithinMs);
    expect(CRON_BUDGET.stopWithinMs).toBeLessThanOrEqual(maxDuration * 1000 - 20_000);
  });

  it("caps one channel below the run total, so one busy channel cannot starve the others", () => {
    expect(CRON_BUDGET.perChannel).toBeLessThan(CRON_BUDGET.maxWork);
    expect(CRON_BUDGET.perChannel * 3).toBeGreaterThanOrEqual(CRON_BUDGET.maxWork);
  });
});

describe("runAutomaticChannels with a budget", () => {
  it("stops at the total post cap, defers the rest and notes it in channel_runs", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const [summary] = await runAutomaticChannels(deps, {
      channels: ["rentcast"],
      budget: { ...BUDGET, maxWork: 3 },
      clients: { rentcast: rentcast(records(5)) },
    });
    expect(summary).toMatchObject({ seen: 5, newCount: 3, deferred: 2 });
    const [run] = await db.select().from(channelRuns);
    expect(run?.error).toContain("2 posts deferred");
  });

  it("shares the cap across channels: a channel that cannot start is skipped and not recorded as run", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const search = rentcast(records(2));
    const summaries = await runAutomaticChannels(deps, {
      budget: { ...BUDGET, maxWork: 1 },
      clients: {
        supost: { listings: async () => ({ ok: true, data: jsonFixture<{ listings: never[]; next_cursor: null }>("supost-item.json") }) },
        gmail: { listMessages: async () => ({ ok: false, error: "disabled" }), getMessage: async () => ({ ok: false, error: "disabled" }) },
        rentcast: search,
      },
    });
    expect(summaries.map((s) => [s.channel, s.newCount])).toEqual([
      ["supost", 1],
      ["gmail_alerts", 0],
      ["rentcast", 0],
    ]);
    expect(summaries[1]?.skipped).toContain("budget");
    expect(summaries[2]?.skipped).toContain("budget");
    // Only the channel that ran has a row, so RentCast still counts as not run and goes first tomorrow.
    expect((await db.select().from(channelRuns)).map((r) => r.channel)).toEqual(["supost"]);
  });

  it("starts no new post after the start deadline", async () => {
    const { deps, calls } = await makeDeps(FIXTURE_REPLIES);
    let now = 0;
    const [summary] = await runAutomaticChannels(deps, {
      channels: ["rentcast"],
      budget: { ...BUDGET, startWithinMs: 500 },
      clock: () => now,
      // Collecting takes "a second", which uses up the 500 ms start window.
      clients: { rentcast: rentcast(records(4), () => (now += 1000)) },
    });
    expect(summary).toMatchObject({ seen: 4, newCount: 0, deferred: 4 });
    // Only the office was geocoded, for the RentCast search. No listing was started.
    expect(calls.geocode).toEqual([deps.settings.officeAddress]);
    expect(calls.transit).toBe(0);
  });

  it("gives up on a post that outlasts the hard stop, defers it and the rest, and still records the run", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    deps.geo = { ...deps.geo, transit: () => new Promise(() => {}) }; // a routing service that never answers
    const [summary] = await runAutomaticChannels(deps, {
      channels: ["rentcast"],
      budget: { ...BUDGET, stopWithinMs: 40 },
      clients: { rentcast: rentcast(records(3)) },
    });
    // The abandoned post is not counted as done: it is deferred with the two that never started.
    expect(summary).toMatchObject({ seen: 3, newCount: 0, deferred: 3 });
    expect(summary?.outcomes).toHaveLength(0);
    const [run] = await db.select().from(channelRuns);
    expect(run?.error).toBe("3 posts deferred to the next run (one took too long)");
  });

  it("without a budget the old per-channel limit is the only cap", async () => {
    const { deps } = await makeDeps(FIXTURE_REPLIES);
    const [summary] = await runAutomaticChannels(deps, {
      channels: ["rentcast"],
      limit: 2,
      clients: { rentcast: rentcast(records(3)) },
    });
    expect(summary).toMatchObject({ newCount: 2, deferred: 1 });
  });
});
