// The read layer (src/lib/queries) against a fresh in-memory database with the demo data.

import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db";
import { SOFT_FACTORS } from "@/db/defaults";
import { DEMO_GROUPS, DEMO_LISTINGS, databaseProtocol, exampleSettings, seedDemo } from "@/db/demo";
import { runMigrations } from "@/db/run-migrations";
import { listings } from "@/db/schema";
import { applyFeedback, type Weights } from "@/lib/domain";
import {
  compareListings,
  getBoard,
  getChatMessages,
  getFeedbackEvents,
  getLeads,
  getListing,
  getSettings,
  getSourceRuns,
  recordFact,
  saveChatMessage,
  saveFeedbackEvent,
  setUserStatus,
  undoLastFeedbackEvent,
  updateRoommateLeadStatus,
  updateSettings,
} from "@/lib/queries";

const NOW = new Date("2026-12-01T16:00:00Z");
let db: Db;
const opts = () => ({ db, now: () => NOW });

beforeEach(async () => {
  db = createDb(":memory:");
  await runMigrations(db);
  await seedDemo(db, { now: NOW });
});

const ORDER = ["pass", "likely", "needs_info", "fail"];

describe("demo seed", () => {
  it("writes 12 listings in the planned buckets, from every source, with roommates", async () => {
    const board = await getBoard({}, opts());
    expect(board.items).toHaveLength(12);
    expect(board.counts).toEqual({ pass: 3, likely: 2, needs_info: 4, fail: 3, unanalyzed: 0 });
    expect(new Set(board.items.map((i) => i.source))).toEqual(
      new Set(["supost", "craigslist", "zillow", "hotpads", "facebook_group", "rentcast", "example-rentals.test", "paste"]),
    );
    expect(board.items.some((i) => i.hasRoommates === true)).toBe(true);
  });

  it("uses only fictional places and example links", () => {
    for (const demo of DEMO_LISTINGS) {
      expect(demo.title).toContain("(sample)");
      if (demo.address) expect(demo.address).toMatch(/Sample|Example|Demo|Placeholder/);
    }
  });

  it("refuses a database that already has listings, and --reset replaces everything", async () => {
    await expect(seedDemo(db, { now: NOW })).rejects.toThrow(/already has listings/);
    const result = await seedDemo(db, { now: NOW, reset: true });
    expect(result.listings).toBe(12);
    const rows = await db.select({ id: listings.id }).from(listings);
    expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("treats an in-memory database as local, so the reset above is allowed", () => {
    expect(databaseProtocol(db)).toBe("file");
  });

  it.each(["libsql://127.0.0.1:1?tls=0", "https://127.0.0.1:1"])(
    "refuses to reset a remote database (%s) before sending any query",
    async (url) => {
      // Nothing listens on port 1: if the guard ran after a query, the error would be a
      // connection failure instead of the refusal. No live service is contacted.
      const remote = createDb(url, "");
      await expect(seedDemo(remote, { now: NOW, reset: true })).rejects.toThrow(/Refusing to reset a remote database/);
      (remote as typeof remote & { $client: { close(): void } }).$client.close();
    },
  );
});

describe("getBoard", () => {
  it("sorts by bucket, then score high to low", async () => {
    const { items } = await getBoard({}, opts());
    for (let i = 1; i < items.length; i++) {
      const [a, b] = [items[i - 1]!, items[i]!];
      const byBucket = ORDER.indexOf(a.bucket!) - ORDER.indexOf(b.bucket!);
      expect(byBucket).toBeLessThanOrEqual(0);
      if (byBucket === 0) expect(a.score ?? -1).toBeGreaterThanOrEqual(b.score ?? -1);
    }
  });

  it("filters by bucket and by my status; counts follow the status filter", async () => {
    const likely = await getBoard({ bucket: "likely" }, opts());
    expect(likely.items.map((i) => i.bucket)).toEqual(["likely", "likely"]);
    expect(likely.items.every((i) => i.likelyReason === "confirm fees with landlord")).toBe(true);
    expect(likely.items.some((i) => i.scamNote === "scam checks pending")).toBe(true);
    expect(likely.counts.pass).toBe(3);

    const shortlisted = await getBoard({ status: "shortlisted" }, opts());
    expect(shortlisted.items).toHaveLength(1);
    expect(shortlisted.counts).toMatchObject({ pass: 1, fail: 0 });
  });

  it("cards carry the numbers from the database, and the reason a fail failed", async () => {
    const { items } = await getBoard({}, opts());
    const first = items[0]!;
    expect(first).toMatchObject({ bucket: "pass", allInMonthlyCents: 165000, rentCents: 165000, commuteMinutes: 23, nearestStop: "California Ave" });
    expect(first.photoUrl).toMatch(/^https:\/\/example\.com\//);
    expect(first.strength).not.toBeNull();
    expect(items.find((i) => i.bucket === "fail" && i.failReason?.startsWith("Sublet ends"))).toBeDefined();
    const noAddress = items.find((i) => i.source === "supost" && i.bucket === "needs_info")!;
    expect(noAddress.commuteMinutes).toBeNull();
    expect(noAddress.allInMonthlyCents).toBeNull();
  });
});

describe("getListing", () => {
  it("returns facts with provenance, cost lines, filter reasons, commute, places, trust, photos and sources", async () => {
    const detail = (await getListing(1, opts()))!;
    expect(detail.listing.title).toContain("private bath");
    expect(detail.facts.canMeetRoommates?.current).toMatchObject({ value: true, provenance: "landlord" });
    expect(detail.facts.rentCents?.current).toMatchObject({ value: 165000, provenance: "listing" });
    expect(detail.facts.commuteMinutes?.current?.provenance).toBe("api");
    expect(detail.cost?.lines.find((l) => l.key === "rent")).toMatchObject({ status: "confirmed", monthlyCents: 165000 });
    expect(detail.filters?.results).toHaveLength(9);
    expect(detail.filters?.results.every((r) => r.status === "pass" && r.reason.length > 0)).toBe(true);
    expect(detail.commute.legs.find((l) => l.mode === "transit")).toMatchObject({ agency: "caltrain", from: "California Ave" });
    expect(detail.transit.stops[0]).toMatchObject({ name: "California Ave", scheduleBasis: "target_date" });
    expect(detail.places?.grocery).toMatchObject({ name: "Sample Market", walkMinutes: 6 });
    expect(detail.trust).toHaveLength(7);
    expect(detail.trust.every((c) => c.status === "pass")).toBe(true);
    expect(detail.photos).toHaveLength(4);
    expect(detail.sources[0]?.url).toBe("https://example.com/demo-listings/1");
    expect(detail.roommates.map((r) => r.status)).toEqual(["Met", "Call scheduled"]);
    expect(detail.scoreBreakdown?.factors).toHaveLength(SOFT_FACTORS.length);
  });

  it("shows when a stop's frequency is based on the current schedule", async () => {
    const detail = (await getListing(7, opts()))!;
    expect(detail.transit.stops[0]).toMatchObject({ name: "Sample St & Example Ave", scheduleBasis: "current_schedule", scheduleDate: "2027-01-05" });
  });

  it("lists the open questions of a needs-info listing, and null for no such listing", async () => {
    const detail = (await getListing(7, opts()))!;
    expect(detail.bucket).toBe("needs_info");
    expect(detail.filters?.questions.map((q) => q.field)).toContain("privateBath");
    expect(await getListing(999, opts())).toBeNull();
  });
});

describe("compareListings", () => {
  it("puts listings side by side and marks rows that differ", async () => {
    const result = await compareListings([1, 2, 999], opts());
    expect(result.listings.map((l) => l.listing.id)).toEqual([1, 2]);
    expect(result.missing).toEqual([999]);
    expect(result.rows.find((r) => r.key === "bucket")).toMatchObject({ values: ["pass", "pass"], differs: false });
    expect(result.rows.find((r) => r.key === "rent")).toMatchObject({ values: [165000, 210000], differs: true });
    expect(result.rows.find((r) => r.key === "filter_lease")?.values).toEqual(["pass", "pass"]);
  });
});

describe("leads and sources", () => {
  it("lists roommate leads newest first and updates their status", async () => {
    const leads = await getLeads(opts());
    expect(leads).toHaveLength(3);
    expect(leads[0]?.status).toBe("new");
    const updated = await updateRoommateLeadStatus({ id: leads[0]!.id, status: "messaged", notes: "Sent an intro" }, opts());
    expect(updated).toMatchObject({ ok: true, data: { status: "messaged", notes: "Sent an intro" } });
    expect(await updateRoommateLeadStatus({ id: 999, status: "messaged" }, opts())).toEqual({ ok: false, error: "no such lead" });
    expect(await updateRoommateLeadStatus({ id: leads[0]!.id, status: "sent" as never }, opts())).toEqual({ ok: false, error: "unknown status" });
  });

  it("reports each channel's last run, errors and the last capture per Facebook group", async () => {
    const runs = await getSourceRuns(opts());
    const supost = runs.channels.find((c) => c.channel === "supost")!;
    expect(supost).toMatchObject({ lastError: null, lastItemsNew: 3, newLast24h: 3, runsLast24h: 1 });
    expect(runs.channels.find((c) => c.channel === "rentcast")?.lastError).toMatch(/disabled/);
    expect(runs.channels.find((c) => c.channel === "apify")).toMatchObject({ lastRunAt: null, newLast24h: 0 });
    const old = runs.facebookGroups.find((g) => g.groupName === DEMO_GROUPS[0])!;
    expect(NOW.getTime() - new Date(old.lastCapturedAt).getTime()).toBeGreaterThan(20 * 3_600_000);
  });
});

describe("settings and weights", () => {
  it("returns the example settings and equal weights", async () => {
    const { settings, weights } = await getSettings(opts());
    expect(settings).toEqual(exampleSettings());
    expect(weights.map((w) => w.factor)).toEqual([...SOFT_FACTORS]);
    expect(weights.reduce((sum, w) => sum + w.weight, 0)).toBeCloseTo(1, 10);
  });

  it("updating a setting rechecks every listing; an invalid value is refused", async () => {
    const result = await updateSettings({ budgetCapCents: 160000 }, opts());
    expect(result).toMatchObject({ ok: true, data: { listingsRechecked: 12 } });
    const board = await getBoard({}, opts());
    expect(board.counts.pass).toBe(0);
    expect(await updateSettings({ budgetCapCents: -5 }, opts())).toMatchObject({ ok: false });
    expect((await getSettings(opts())).settings.budgetCapCents).toBe(160000);
  });
});

describe("small writes", () => {
  it("shortlists and rejects with a reason, and clearing drops the reason", async () => {
    expect(await setUserStatus({ listingId: 2, status: "rejected", reason: "  Too far  " }, opts())).toMatchObject({ ok: true, data: { reason: "Too far" } });
    expect((await getListing(2, opts()))?.listing).toMatchObject({ userStatus: "rejected", userStatusReason: "Too far" });
    await setUserStatus({ listingId: 2, status: "none", reason: "ignored" }, opts());
    expect((await getListing(2, opts()))?.listing).toMatchObject({ userStatus: "none", userStatusReason: null });
    expect(await setUserStatus({ listingId: 999, status: "shortlisted" }, opts())).toEqual({ ok: false, error: "no such listing" });
  });

  it("records a landlord's answer, keeps the listing's row, re-runs the analysis and says what changed", async () => {
    // Listing 5 is likely: its non-refundable deposit and one-time fees are Unknown.
    const first = await recordFact({ listingId: 5, field: "nonRefundableDepositCents", value: 0, provenance: "landlord", note: "said on a call" }, opts());
    expect(first).toMatchObject({ ok: true, data: { before: { bucket: "likely" }, after: { bucket: "likely" } } });
    const second = await recordFact({ listingId: 5, field: "oneTimeFeesCents", value: 5000, provenance: "landlord" }, opts());
    expect(second.ok && second.data).toMatchObject({ before: { bucket: "likely" }, after: { bucket: "pass" } });
    expect(second.ok && second.data.changed).toContain("bucket");
    const detail = (await getListing(5, opts()))!;
    expect(detail.facts.nonRefundableDepositCents?.current).toMatchObject({ value: 0, provenance: "landlord", note: "said on a call" });
    expect((await getBoard({ bucket: "pass" }, opts())).items.map((i) => i.id)).toContain(5);
  });

  it("a landlord's answer wins over the listing but both rows stay", async () => {
    await recordFact({ listingId: 1, field: "rentCents", value: 170000, provenance: "landlord" }, opts());
    const detail = (await getListing(1, opts()))!;
    expect(detail.facts.rentCents?.current).toMatchObject({ value: 170000, provenance: "landlord" });
    expect(detail.facts.rentCents?.rows.map((r) => r.provenance).sort()).toEqual(["landlord", "listing"]);
    expect(detail.allInMonthlyCents).toBe(170000);
  });

  it.each([
    { name: "an unknown field", input: { field: "rent", value: 1 }, error: "unknown field rent" },
    { name: "dollars as text", input: { field: "rentCents", value: "$1,800" }, error: "invalid value for rentCents" },
    { name: "fractional cents", input: { field: "rentCents", value: 1800.5 }, error: "invalid value for rentCents" },
    { name: "a null value", input: { field: "furnished", value: null }, error: "invalid value for furnished" },
    { name: "a model provenance", input: { field: "furnished", value: true, provenance: "api" }, error: "provenance must be me or landlord" },
  ])("refuses $name", async ({ input, error }) => {
    const result = await recordFact({ listingId: 1, provenance: "me", ...input } as Parameters<typeof recordFact>[0], opts());
    expect(result).toEqual({ ok: false, error });
  });
});

describe("chat and feedback storage", () => {
  it("stores chat messages as JSON and returns the latest, oldest first", async () => {
    await saveChatMessage({ role: "user", content: { parts: [{ type: "text", text: "hi" }] } }, opts());
    await saveChatMessage({ role: "assistant", content: { parts: [{ type: "text", text: "hello" }] } }, opts());
    const messages = await getChatMessages({ limit: 10 }, opts());
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.content).toEqual({ parts: [{ type: "text", text: "hi" }] });
  });

  it("saves a feedback event with weights before and after, rescores, and undo restores them", async () => {
    const before = Object.fromEntries((await getSettings(opts())).weights.map((w) => [w.factor, w.weight])) as Weights;
    const scoreBefore = (await getListing(6, opts()))!.score;
    const { weights: after } = applyFeedback(before, [{ factor: "transit_quality", direction: "up", size: "medium" }]);

    const saved = await saveFeedbackEvent({ listingId: 6, reason: "too far from Caltrain", weightsAfter: after }, opts());
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.weightsBefore.transit_quality).toBeCloseTo(before.transit_quality, 10);
    expect(saved.data.weightsAfter.transit_quality).toBeGreaterThan(before.transit_quality);
    const { weights } = await getSettings(opts());
    expect(weights.find((w) => w.factor === "transit_quality")).toMatchObject({ weight: after.transit_quality, setBy: "chat" });
    expect((await getListing(6, opts()))!.score).not.toBe(scoreBefore);

    const undone = await undoLastFeedbackEvent(opts());
    expect(undone?.id).toBe(saved.data.id);
    expect(undone?.undoneAt).toBe(NOW.toISOString());
    const restored = (await getSettings(opts())).weights.find((w) => w.factor === "transit_quality")!;
    expect(restored.weight).toBeCloseTo(before.transit_quality, 10);
    expect((await getListing(6, opts()))!.score).toBeCloseTo(scoreBefore!, 10);
    expect(await undoLastFeedbackEvent(opts())).toBeNull();
    expect((await getFeedbackEvents({}, opts()))[0]?.undoneAt).not.toBeNull();
  });

  it("refuses an event with no reason, incomplete weights or an unknown listing", async () => {
    const weights = Object.fromEntries(SOFT_FACTORS.map((f) => [f, 1 / SOFT_FACTORS.length])) as Weights;
    expect(await saveFeedbackEvent({ reason: " ", weightsAfter: weights }, opts())).toMatchObject({ ok: false });
    expect(await saveFeedbackEvent({ reason: "x", weightsAfter: { commute: 1 } as Weights }, opts())).toMatchObject({ ok: false });
    expect(await saveFeedbackEvent({ listingId: 999, reason: "x", weightsAfter: weights }, opts())).toMatchObject({ ok: false, error: "no such listing" });
  });
});
