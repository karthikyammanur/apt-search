// The capture route's time budget: process what fits, save the rest as pending, and let the next
// cron run finish it. The extension shows "saved, will finish processing later" for those.

import { describe, expect, it } from "vitest";
import { channelRuns, listings, pendingCaptures, roommateLeads } from "@/db/schema";
import { handleCapture } from "@/lib/intake/capture";
import { countPending, failPending, loadPending, MAX_PENDING_ATTEMPTS, savePending } from "@/lib/intake/pending";
import { runAutomaticChannels } from "@/lib/intake/run";
import type { RawListing } from "@/lib/intake/types";
import { FIXTURE_REPLIES, jsonFixture, makeDeps } from "./helpers";

const TOKEN = "test-capture-token-0123456789";
const BIG = { startWithinMs: 1_000_000, stopWithinMs: 2_000_000 };

const capture = (ctx: Awaited<ReturnType<typeof makeDeps>>, body: unknown, budget: { maxWork: number; startWithinMs: number; stopWithinMs: number }) =>
  handleCapture({ token: TOKEN, expectedToken: TOKEN, body }, async () => ctx.deps, { budget });

const results = (response: { body: Record<string, unknown> }) => response.body.results as { status: string }[];

const off = { ok: false as const, error: "disabled" as const };
const quietClients = {
  supost: { listings: async () => off },
  gmail: { listMessages: async () => off, getMessage: async () => off },
  rentcast: { listings: async () => off },
};

const post = (n: number, text = `Unmatched sample post ${n}`): RawListing => ({
  channel: "facebook_capture",
  source: "facebook_group",
  url: `https://www.facebook.com/groups/1/posts/${n}/`,
  title: null,
  text,
  photoUrls: [],
  photoHashes: [],
  groupName: "Sample Group",
});

describe("a capture that does not fit in the budget", () => {
  it("processes what fits, saves the rest as pending, and says how many", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    const response = await capture(ctx, jsonFixture("facebook-batch.json"), { maxWork: 1, ...BIG });
    expect(response.status).toBe(200);
    expect(results(response).map((r) => r.status)).toEqual(["stored"]);
    expect(response.body.pending).toBe(1);

    expect(await ctx.db.select().from(listings)).toHaveLength(1);
    expect(await ctx.db.select().from(roommateLeads)).toHaveLength(0);
    const waiting = await ctx.db.select().from(pendingCaptures);
    expect(waiting.map((row) => row.url)).toEqual(["https://www.facebook.com/groups/123456789/posts/222222222/"]);

    // The run is recorded with what was actually done, and a note that it is not complete.
    const [run] = await ctx.db.select().from(channelRuns);
    expect(run).toMatchObject({ channel: "facebook_capture", itemsSeen: 1, itemsNew: 1, error: "1 posts saved to finish on the next run" });
  });

  it("answers pending 0 and saves nothing when everything fits", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    const response = await capture(ctx, jsonFixture("facebook-batch.json"), { maxWork: 50, ...BIG });
    expect(response.body.pending).toBe(0);
    expect(results(response)).toHaveLength(2);
    expect(await countPending(ctx.db)).toBe(0);
  });

  it("queues the same post once, however often it is captured", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    const batch = jsonFixture("facebook-batch.json");
    await capture(ctx, batch, { maxWork: 0, ...BIG });
    await capture(ctx, batch, { maxWork: 0, ...BIG });
    expect(await countPending(ctx.db)).toBe(2);
    expect(await ctx.db.select().from(listings)).toHaveLength(0);
  });

  it("gives up on a post that outlasts the hard stop and saves it with the rest", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    ctx.deps.geo = { ...ctx.deps.geo, transit: () => new Promise(() => {}) }; // a routing service that never answers
    const response = await capture(ctx, jsonFixture("facebook-batch.json"), { maxWork: 50, startWithinMs: 1_000_000, stopWithinMs: 40 });
    expect(response.status).toBe(200);
    expect(results(response)).toHaveLength(0);
    expect(response.body.pending).toBe(2);
    expect(await countPending(ctx.db)).toBe(2);
  });
});

describe("the next cron run finishes pending posts", () => {
  it("processes them first, removes them, and records the run", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    await capture(ctx, jsonFixture("facebook-batch.json"), { maxWork: 1, ...BIG });
    expect(await countPending(ctx.db)).toBe(1);

    const [first, ...rest] = await runAutomaticChannels(ctx.deps, { clients: quietClients });
    expect(first).toMatchObject({ channel: "pending_captures", seen: 1, newCount: 1, deferred: 0, error: null });
    expect(rest.map((s) => s.channel)).toEqual(["supost", "gmail_alerts", "rentcast"]);
    expect(await countPending(ctx.db)).toBe(0);
    expect(await ctx.db.select().from(roommateLeads)).toHaveLength(1);
    // The capture's own row plus the one for the posts finished later.
    expect((await ctx.db.select().from(channelRuns)).filter((r) => r.channel === "facebook_capture")).toHaveLength(2);
  });

  it("adds nothing to the summary when nothing is waiting", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    const summaries = await runAutomaticChannels(ctx.deps, { clients: quietClients });
    expect(summaries.map((s) => s.channel)).toEqual(["supost", "gmail_alerts", "rentcast"]);
  });

  it("is not run by a call that names its channels", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    await savePending(ctx.db, [post(1)], "2026-12-01T00:00:00Z");
    await runAutomaticChannels(ctx.deps, { channels: ["rentcast"], clients: quietClients });
    expect(await countPending(ctx.db)).toBe(1);
  });

  it("spends the shared budget on pending posts first and leaves the rest for the next run", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    await savePending(ctx.db, [post(1), post(2), post(3)], "2026-12-01T00:00:00Z");
    const [first, ...rest] = await runAutomaticChannels(ctx.deps, {
      clients: quietClients,
      budget: { maxWork: 1, ...BIG },
    });
    expect(first).toMatchObject({ channel: "pending_captures", seen: 3, deferred: 2 });
    expect(first?.error).toBe("2 posts deferred to the next run");
    // Only the posts that were not tried stay; the budget was used up, so the channels are skipped.
    expect(rest.every((s) => s.skipped?.includes("budget"))).toBe(true);
  });

  it("tries a failing post three times, then drops it", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    await savePending(ctx.db, [post(1)], "2026-12-01T00:00:00Z"); // no canned model reply matches it
    for (let attempt = 1; attempt < MAX_PENDING_ATTEMPTS; attempt++) {
      await runAutomaticChannels(ctx.deps, { clients: quietClients });
      expect((await loadPending(ctx.db, 10))[0]?.attempts).toBe(attempt);
    }
    await runAutomaticChannels(ctx.deps, { clients: quietClients });
    expect(await countPending(ctx.db)).toBe(0);
  });
});

describe("the pending store", () => {
  it("drops a stored row that no longer parses instead of retrying it forever", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    await ctx.db.insert(pendingCaptures).values({ url: "https://x.example.test/bad", raw: { nonsense: true }, createdAt: "2026-12-01T00:00:00Z" });
    expect(await loadPending(ctx.db, 10)).toEqual([]);
    expect(await countPending(ctx.db)).toBe(0);
  });

  it("only keeps the shapes the capture route can produce", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    const paste: RawListing = { ...post(1), channel: "paste" };
    expect(await savePending(ctx.db, [paste, post(2)], "2026-12-01T00:00:00Z")).toBe(1);
  });

  it("counts failed tries and removes the row on the last one", async () => {
    const ctx = await makeDeps(FIXTURE_REPLIES);
    await savePending(ctx.db, [post(1)], "2026-12-01T00:00:00Z");
    const [row] = await loadPending(ctx.db, 10);
    await failPending(ctx.db, row!);
    expect((await loadPending(ctx.db, 10))[0]?.attempts).toBe(1);
    await failPending(ctx.db, { ...row!, attempts: MAX_PENDING_ATTEMPTS - 1 });
    expect(await countPending(ctx.db)).toBe(0);
  });
});
