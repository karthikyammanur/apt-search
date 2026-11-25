import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db";
import { runMigrations } from "@/db/run-migrations";
import { channelRuns, listings, photos, roommateLeads, transitStops } from "@/db/schema";
import { sourceLinksSchema } from "@/db/source-links";
import { desc, eq, sql } from "drizzle-orm";

let db: Db;

beforeEach(async () => {
  db = createDb(":memory:");
  await runMigrations(db);
});

describe("migrations create every table", () => {
  it("has the nine design tables, photos, the four tables added in step 1b, the two added in step 6a and pending_captures from deploy-prep", async () => {
    const rows = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      "api_cache",
      "channel_runs",
      "chat",
      "chat_messages",
      "enrichment",
      "facts",
      "feedback",
      "feedback_events",
      "listings",
      "login_attempts",
      "pending_captures",
      "photos",
      "preferences",
      "roommate_leads",
      "roommates",
      "settings",
      "transit_stops",
    ]);
  });
});

describe("listings: Facebook and merge columns", () => {
  it("defaults post_type to unknown and source_links to an empty list", async () => {
    await db.insert(listings).values({ source: "supost", firstSeen: "2026-11-19" });
    const [listing] = await db.select().from(listings);
    expect(listing).toMatchObject({
      postType: "unknown",
      groupName: null,
      posterProfileUrl: null,
      sourceLinks: [],
    });
  });

  it("stores Facebook details and merged source links as JSON", async () => {
    const sourceLinks = [
      {
        source: "facebook_group",
        url: "https://example.com/post/1",
        seen_at: "2026-11-19T10:00:00Z",
      },
      {
        source: "gmail_alerts",
        url: "https://example.com/post/1?alert",
        seen_at: "2026-11-19T11:00:00Z",
      },
    ];
    await db.insert(listings).values({
      source: "facebook_group",
      firstSeen: "2026-11-19",
      postType: "room_offered",
      groupName: "Example housing group",
      posterProfileUrl: "https://example.com/profile/1",
      sourceLinks,
    });
    const [listing] = await db.select().from(listings);
    expect(listing?.postType).toBe("room_offered");
    expect(listing?.groupName).toBe("Example housing group");
    expect(sourceLinksSchema.parse(listing?.sourceLinks)).toEqual(sourceLinks);
  });

  it("the source link schema rejects a link with no timestamp", () => {
    expect(
      sourceLinksSchema.safeParse([{ source: "supost", url: "https://example.com" }]).success,
    ).toBe(false);
    expect(
      sourceLinksSchema.safeParse([
        { source: "supost", url: "https://example.com", seen_at: "yesterday" },
      ]).success,
    ).toBe(false);
  });
});

describe("photos.phash", () => {
  it("is null until a hash is computed", async () => {
    await db.insert(listings).values({ source: "test", firstSeen: "2026-11-19" });
    await db
      .insert(photos)
      .values({ listingId: 1, url: "https://example.com/a.jpg", source: "supost" });
    await db.insert(photos).values({
      listingId: 1,
      url: "https://example.com/b.jpg",
      source: "supost",
      phash: "c3d4e5f6a7b8c9d0",
    });
    const rows = await db.select().from(photos).orderBy(photos.id);
    expect(rows.map((row) => row.phash)).toEqual([null, "c3d4e5f6a7b8c9d0"]);
  });
});

describe("roommate_leads", () => {
  it("starts as new, and keeps an unstated budget as null rather than 0", async () => {
    await db
      .insert(roommateLeads)
      .values({ source: "facebook_capture", createdAt: "2026-11-19T10:00:00Z" });
    await db.insert(roommateLeads).values({
      source: "facebook_capture",
      createdAt: "2026-11-19T10:05:00Z",
      budgetCents: 150000,
      status: "talking",
    });
    const rows = await db.select().from(roommateLeads).orderBy(roommateLeads.id);
    expect(rows.map((row) => [row.status, row.budgetCents])).toEqual([
      ["new", null],
      ["talking", 150000],
    ]);
  });
});

describe("channel_runs", () => {
  it("answers 'when did each channel last run' and 'when was each group last captured'", async () => {
    await db.insert(channelRuns).values([
      { channel: "supost", ranAt: "2026-11-18T06:00:00Z", itemsSeen: 40, itemsNew: 3 },
      {
        channel: "supost",
        ranAt: "2026-11-19T06:00:00Z",
        itemsSeen: 42,
        itemsNew: 0,
        error: "timeout",
      },
      {
        channel: "facebook_capture",
        groupName: "Group A",
        ranAt: "2026-11-19T09:00:00Z",
        itemsSeen: 25,
        itemsNew: 6,
      },
      {
        channel: "facebook_capture",
        groupName: "Group B",
        ranAt: "2026-11-17T09:00:00Z",
        itemsSeen: 18,
        itemsNew: 2,
      },
    ]);

    const [lastSupost] = await db
      .select()
      .from(channelRuns)
      .where(eq(channelRuns.channel, "supost"))
      .orderBy(desc(channelRuns.ranAt))
      .limit(1);
    expect(lastSupost).toMatchObject({
      ranAt: "2026-11-19T06:00:00Z",
      itemsNew: 0,
      error: "timeout",
    });

    const groups = await db
      .select()
      .from(channelRuns)
      .where(eq(channelRuns.channel, "facebook_capture"));
    expect(groups.map((row) => row.groupName).sort()).toEqual(["Group A", "Group B"]);
    expect(
      (await db.select().from(channelRuns).where(eq(channelRuns.id, 1)))[0]?.groupName,
    ).toBeNull();
  });
});

describe("transit_stops", () => {
  const stop = (feed: string, stopId: string) => ({
    feed,
    stopId,
    name: "Example Stop",
    lat: 37.4,
    lng: -122.1,
    modes: ["rail"],
    weekdayRushDepartures: 24,
    computedAt: "2026-11-19T00:00:00Z",
  });

  it("is keyed by (feed, stop_id): the same stop id may exist in two feeds", async () => {
    await db.insert(transitStops).values(stop("feed-a", "100"));
    await db.insert(transitStops).values(stop("feed-b", "100"));
    expect(await db.select().from(transitStops)).toHaveLength(2);
    await expect(db.insert(transitStops).values(stop("feed-a", "100"))).rejects.toThrow();
  });

  it("keeps an unknown headway as null and stores modes as a JSON list", async () => {
    await db
      .insert(transitStops)
      .values({ ...stop("feed-a", "7"), modes: ["bus", "rail"], weekdayRushDepartures: 0 });
    const [row] = await db.select().from(transitStops);
    expect(row).toMatchObject({
      medianRushHeadwayMin: null,
      weekdayRushDepartures: 0,
      modes: ["bus", "rail"],
    });
  });
});
