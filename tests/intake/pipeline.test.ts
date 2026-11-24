// The six fixtures run end to end through the real pipeline, with a stub model and stub map
// services. Nothing touches the network.

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichment, facts, listings, photos, roommateLeads } from "@/db/schema";
import { PROVENANCE } from "@/db/schema";
import { readAnalysis } from "@/lib/intake/analysis";
import { captureToRaw, batchSchema, pageSchema } from "@/lib/intake/capture";
import { collectSupost, supostToRaw } from "@/lib/intake/channels/supost";
import { parseEmail } from "@/lib/intake/channels/email";
import { intakeFromText, processRaw } from "@/lib/intake/pipeline";
import type { RawListing } from "@/lib/intake/types";
import { FIXTURE_REPLIES, emailFixture, jsonFixture, makeDeps } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const supostRaw = (): RawListing => {
  const item = jsonFixture<{ listings: Parameters<typeof supostToRaw>[0][] }>("supost-item.json").listings[0];
  return supostToRaw(item as Parameters<typeof supostToRaw>[0]) as RawListing;
};
const pageRaw = (): RawListing => captureToRaw(pageSchema.parse(jsonFixture("extension-page.json")))[0] as RawListing;
const batchRaw = (): RawListing[] => captureToRaw(batchSchema.parse(jsonFixture("facebook-batch.json")));
const email = (id: string) => parseEmail(emailFixture(id)).listings;

describe("all six fixtures, end to end", () => {
  it("processes every one and lands each in the right place", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const inputs: RawListing[] = [
      ...email("msg-craigslist-1"),
      ...email("msg-zillow-1"),
      ...email("msg-facebook-1"),
      supostRaw(),
      pageRaw(),
      ...batchRaw(),
    ];
    // 1 craigslist + 2 zillow + 1 facebook email + 1 supost + 1 page + 2 facebook posts.
    expect(inputs).toHaveLength(8);
    const outcomes = [];
    for (const raw of inputs) outcomes.push(await processRaw(deps, raw));

    expect(outcomes.map((o) => o.status)).toEqual([
      "stored", // craigslist room
      "stored", // zillow studio
      "stored", // zillow 2 bd, fails the budget and stops early
      "stored", // facebook email sublet
      "stored", // supost
      "stored", // extension page
      "stored", // facebook room
      "roommate_lead", // facebook roommate wanted
    ]);
    const stored = await db.select().from(listings);
    expect(stored).toHaveLength(7);
    expect(await db.select().from(roommateLeads)).toHaveLength(1);
    expect(outcomes.every((o) => o.status !== "error")).toBe(true);
  });

  it("stores a readable analysis envelope with a bucket, cost and score for each listing", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const outcome = await processRaw(deps, pageRaw());
    expect(outcome.status).toBe("stored");
    const [row] = await db.select().from(enrichment).where(eq(enrichment.listingId, outcome.listingId as number));
    const analysis = readAnalysis(row?.costBreakdown);
    expect(analysis).not.toBeNull();
    expect(analysis?.bucket).toBe(outcome.bucket);
    expect(row?.allInMonthly).toBe(analysis?.cost.allInMonthlyCents);
    expect(row?.commuteTransitMin).toBe(24);
    expect(row?.commuteBikeMin).toBe(18);
    expect(row?.nearestStop).toBe("Test Station");
    expect(row?.rushHeadwayMin).toBe(15);
    expect(analysis?.score).not.toBeNull();
    // The envelope survives a JSON round trip (the exact fraction was turned into a string).
    expect(() => JSON.stringify(analysis)).not.toThrow();
  });

  it("computes the commute, bike, stops and places for a survivor, and keeps what it cannot know Unknown", async () => {
    const { deps, calls } = await makeDeps(FIXTURE_REPLIES);
    const outcome = await processRaw(deps, pageRaw());
    expect(outcome.commuteMinutes).toBe(24);
    expect(calls.transit).toBe(1);
    expect(calls.places).toBe(1);
    // Bike once, and a routed walk for the nearest stop, grocery, gym and cafe only.
    expect(calls.walkBike.filter((m) => m === "BICYCLE")).toHaveLength(1);
    expect(calls.walkBike.filter((m) => m === "WALK")).toHaveLength(4);
    // Move-in, lease and the like are known, but the fee lines are not: all-in stays Unknown.
    expect(outcome.allInMonthlyCents).toBeNull();
  });

  it("a SUPost title with no address stays without a commute, never 0", async () => {
    const { deps, calls } = await makeDeps(FIXTURE_REPLIES);
    const outcome = await processRaw(deps, supostRaw());
    expect(outcome.status).toBe("stored");
    expect(outcome.commuteMinutes).toBeNull();
    expect(outcome.allInMonthlyCents).toBeNull();
    expect(calls.geocode).toHaveLength(0);
    expect(calls.transit).toBe(0);
  });
});

describe("every stored fact has a provenance", () => {
  it("writes only the five allowed values, with listing facts marked listing", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    for (const raw of [...email("msg-craigslist-1"), pageRaw(), supostRaw()]) await processRaw(deps, raw);
    const rows = await db.select().from(facts);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every((row) => (PROVENANCE as readonly string[]).includes(row.provenance))).toBe(true);
    expect(rows.every((row) => row.value !== null && row.checkedAt.length > 0)).toBe(true);
    const rent = rows.filter((row) => row.field === "rentCents");
    expect(rent.map((r) => [r.value, r.provenance]).sort()).toEqual([
      [170000, "listing"],
      [195000, "listing"],
      [220000, "listing"],
    ]);
    // Computed facts are api or estimate, never listing.
    const commute = rows.find((row) => row.field === "commuteMinutes");
    expect(commute?.provenance).toBe("api");
    const scam = rows.find((row) => row.field === "scamChecks");
    expect(scam?.provenance).toBe("estimate");
  });

  it("records an explicit 'no fees' as a stated 0, not as a missing value", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const outcome = await processRaw(deps, email("msg-craigslist-1")[0] as RawListing);
    const rows = await db.select().from(facts).where(eq(facts.listingId, outcome.listingId as number));
    const fees = rows.find((r) => r.field === "mandatoryFeesMonthlyCents");
    expect(fees).toMatchObject({ value: 0, provenance: "listing" });
    expect(rows.find((r) => r.field === "shortTermPremiumCents")).toBeUndefined();
  });
});

describe("a clear Fail skips enrichment", () => {
  it("a $3,900 apartment stops after the cheap filters, with no map call", async () => {
    const { deps, db, calls } = await makeDeps(FIXTURE_REPLIES);
    const raw = email("msg-zillow-1")[1] as RawListing;
    const outcome = await processRaw(deps, raw);
    expect(outcome.status).toBe("stored");
    expect(outcome.bucket).toBe("fail");
    expect(outcome.note).toMatch(/^failed early: /);
    expect(outcome.score).toBeNull();
    expect(calls.geocode).toHaveLength(0);
    expect(calls.transit).toBe(0);
    expect(calls.walkBike).toHaveLength(0);
    expect(calls.places).toBe(0);
    // The listing and the reason it failed are still saved.
    const [row] = await db.select().from(enrichment).where(eq(enrichment.listingId, outcome.listingId as number));
    expect(readAnalysis(row?.costBreakdown)?.bucket).toBe("fail");
    expect(row?.commuteTransitMin).toBeNull();
  });

  it("a survivor in the same run does get enriched", async () => {
    const { deps, calls } = await makeDeps(FIXTURE_REPLIES);
    await processRaw(deps, email("msg-zillow-1")[1] as RawListing);
    await processRaw(deps, email("msg-zillow-1")[0] as RawListing);
    expect(calls.transit).toBe(1);
  });
});

describe("duplicates merge instead of inserting", () => {
  it("the same address and a rent within 5% adds a source link to the saved listing", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const first = await processRaw(deps, batchRaw()[0] as RawListing);
    expect(first.status).toBe("stored");

    // The same room posted on another site, $2,150 against $2,100.
    const second: RawListing = {
      channel: "extension",
      source: "example-rentals.test",
      url: "https://example-rentals.test/room/42",
      text: "Room at 400 Maple Avenue, Mountain View, CA 94040 for $2,150 a month.",
      photoUrls: ["https://images.example.test/other.jpg"],
      photoHashes: [],
    };
    const { deps: deps2 } = await makeDeps(
      [
        { match: "400 Maple Avenue", value: { ...FIXTURE_REPLIES[6]?.value, address: "400 Maple Avenue, Mountain View, CA 94040", rent_usd: 2150 } as never },
        ...FIXTURE_REPLIES,
      ],
      { db },
    );
    const merged = await processRaw(deps2, second);
    expect(merged.status).toBe("merged");
    expect(merged.listingId).toBe(first.listingId);

    const rows = await db.select().from(listings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceLinks.map((l) => l.url)).toContain("https://example-rentals.test/room/42");
    expect(rows[0]?.sourceLinks).toHaveLength(2);
    expect((await db.select().from(photos)).map((p) => p.url)).toContain("https://images.example.test/other.jpg");
  });

  it("a rent more than 5% apart is a different place", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    await processRaw(deps, batchRaw()[0] as RawListing);
    const other: RawListing = { ...batchRaw()[0], url: "https://example-rentals.test/room/43", photoHashes: [] } as RawListing;
    const { deps: deps2 } = await makeDeps(
      [{ match: "400 Maple Ave", value: { ...FIXTURE_REPLIES[6]?.value, rent_usd: 2400 } as never }],
      { db },
    );
    const outcome = await processRaw(deps2, { ...other, text: other.text.replace("$2,100", "$2,400") });
    expect(outcome.status).toBe("stored");
    expect(await db.select().from(listings)).toHaveLength(2);
  });

  it("a matching photo hash merges even when the text differs", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    await processRaw(deps, batchRaw()[0] as RawListing);
    const again: RawListing = {
      channel: "extension",
      source: "example-rentals.test",
      url: "https://example-rentals.test/room/99",
      text: "Furnished room for rent at 400 Maple Ave, Mountain View, CA 94040. $2,100 a month.",
      photoUrls: ["https://images.example.test/z.jpg"],
      photoHashes: ["ph-5f3a9c01"],
    };
    const outcome = await processRaw(deps, again);
    expect(outcome.status).toBe("merged");
    expect(await db.select().from(listings)).toHaveLength(1);
  });

  it("a link already saved is not read by the model again", async () => {
    const { deps, prompts } = await makeDeps(FIXTURE_REPLIES);
    await processRaw(deps, pageRaw());
    const before = prompts.length;
    const again = await processRaw(deps, pageRaw());
    expect(again.status).toBe("already_seen");
    expect(prompts).toHaveLength(before);
  });
});

describe("roommate-wanted posts", () => {
  it("go to roommate_leads, never listings, and dedupe by post URL in code", async () => {
    const { deps, db, prompts } = await makeDeps(FIXTURE_REPLIES);
    const post = batchRaw()[1] as RawListing;
    const first = await processRaw(deps, post);
    expect(first.status).toBe("roommate_lead");
    expect(await db.select().from(listings)).toHaveLength(0);
    const [lead] = await db.select().from(roommateLeads);
    expect(lead).toMatchObject({
      postUrl: post.url,
      posterName: "Jordan Lee",
      groupName: "Bay Area Furnished Rentals & Sublets",
      budgetCents: 240000,
      datesWanted: "Jan to Aug",
      status: "new",
    });
    const calls = prompts.length;
    const second = await processRaw(deps, post);
    expect(second.status).toBe("already_seen");
    expect(prompts).toHaveLength(calls);
    expect(await db.select().from(roommateLeads)).toHaveLength(1);
  });
});

describe("paste fallback", () => {
  it("intakeFromText runs the same pipeline", async () => {
    const { deps } = await makeDeps(FIXTURE_REPLIES);
    const outcome = await intakeFromText(deps, "Private furnished room with its own bathroom at 15 Willow Rd, Redwood City, CA 94061. $2,200 per month.");
    expect(outcome.status).toBe("stored");
    expect(outcome.source).toBe("paste");
  });
});

describe("model and provider failures", () => {
  it("an extraction failure is an error outcome and stores nothing, so the next run retries", async () => {
    const { deps, db } = await makeDeps([]);
    const outcome = await processRaw(deps, pageRaw());
    expect(outcome.status).toBe("error");
    expect(await db.select().from(listings)).toHaveLength(0);
  });

  it("a failed map call leaves the commute Unknown instead of failing the listing", async () => {
    const { deps } = await makeDeps(FIXTURE_REPLIES);
    deps.geo = { ...deps.geo, transit: async () => ({ ok: false, error: "quota_paused" }) };
    const outcome = await processRaw(deps, pageRaw());
    expect(outcome.status).toBe("stored");
    expect(outcome.commuteMinutes).toBeNull();
  });

  it("an address outside California is skipped", async () => {
    const { deps, db } = await makeDeps([
      { match: "Elm St", value: { post_type: "room_offered", address: "9 Elm St, Austin, TX 78701", rent_usd: 1500 } as never },
    ]);
    const outcome = await processRaw(deps, { channel: "paste", source: "paste", url: null, text: "Room at 9 Elm St, Austin, TX 78701, $1,500", photoUrls: [], photoHashes: [] });
    expect(outcome.status).toBe("skipped");
    expect(await db.select().from(listings)).toHaveLength(0);
  });
});

describe("SUPost adapter", () => {
  it("turns an API item into raw text with the price as a stated rent", () => {
    const raw = supostRaw();
    expect(raw.text).toContain("Price: $1700");
    expect(raw.prefill?.facts?.rentCents).toBe(170000);
    expect(raw.url).toBe("https://supost.com/post/90001");
  });

  it("skips regions SUPost does not cover, and tolerates one failing search", async () => {
    const item = jsonFixture<{ listings: unknown[] }>("supost-item.json");
    const ok = { ok: true as const, data: { ...item, next_cursor: null } as never };
    const client = { listings: vi.fn(async (kind: string) => (kind === "shares" ? ({ ok: false, error: "network" } as const) : ok)) };
    expect((await collectSupost(client as never, { region: "bay-area" })).items).toHaveLength(1);
    const other = await collectSupost(client as never, { region: "other" });
    expect(other.skipped).toBeTruthy();
    const down = { listings: async () => ({ ok: false, error: "network" }) as const };
    expect((await collectSupost(down as never, { region: "bay-area" })).error).toContain("rooms: network");
  });
});
