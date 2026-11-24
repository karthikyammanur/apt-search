// Database writes for the pipeline: listings, photos, roommate leads, enrichment, channel runs.
// Rule 2 lives in facts.ts. Nothing here sends anything anywhere.

import { and, desc, eq, isNull } from "drizzle-orm";
import { SOFT_FACTORS } from "@/db/defaults";
import {
  channelRuns,
  enrichment,
  listings,
  photos,
  preferences,
  roommateLeads,
  type CHANNELS,
} from "@/db/schema";
import type { Db } from "@/db";
import type { SourceLink } from "@/db/source-links";
import type { Weights } from "@/lib/domain";
import type { Draft, RawListing } from "./types";

export async function loadWeights(db: Db): Promise<Weights> {
  const rows = await db.select().from(preferences).where(eq(preferences.kind, "soft"));
  const byKey = new Map(rows.map((row) => [row.key, row.weight]));
  const equal = 1 / SOFT_FACTORS.length;
  return Object.fromEntries(
    SOFT_FACTORS.map((factor) => [factor, byKey.get(factor) ?? equal]),
  ) as Weights;
}

export function sourceLinkFor(raw: Pick<RawListing, "source" | "url">, seenAt: string): SourceLink | null {
  return raw.url ? { source: raw.source, url: raw.url, seen_at: seenAt } : null;
}

const TITLE_MAX = 140;

/** A card headline: the post's own title, else the first non-empty line of its text. */
export function listingTitle(raw: Pick<RawListing, "title" | "text">): string | null {
  const first = raw.title?.trim() || raw.text.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() || "";
  return first ? first.slice(0, TITLE_MAX) : null;
}

export async function insertListing(
  db: Db,
  raw: RawListing,
  draft: Draft,
  now: string,
): Promise<number> {
  const link = sourceLinkFor(raw, now);
  const [row] = await db
    .insert(listings)
    .values({
      source: raw.source,
      url: raw.url,
      rawText: raw.text,
      title: listingTitle(raw),
      type: draft.facts.type ?? null,
      postType: draft.postType,
      address: draft.address,
      lat: draft.lat,
      lng: draft.lng,
      city: draft.facts.city ?? null,
      groupName: raw.groupName ?? null,
      posterProfileUrl: raw.posterProfileUrl ?? null,
      sourceLinks: link ? [link] : [],
      status: "New",
      firstSeen: now,
      lastChecked: now,
    })
    .returning({ id: listings.id });
  if (!row) throw new Error("Listing insert returned no row");
  await insertPhotos(db, row.id, raw);
  return row.id;
}

/** Image links only. The server never downloads the images. A hash lines up with the same index. */
export async function insertPhotos(db: Db, listingId: number, raw: RawListing): Promise<number> {
  const existing = await db.select().from(photos).where(eq(photos.listingId, listingId));
  const have = new Set(existing.map((p) => p.url));
  let position = existing.length;
  let added = 0;
  for (const [index, url] of raw.photoUrls.entries()) {
    if (have.has(url)) continue;
    have.add(url);
    await db.insert(photos).values({
      listingId,
      url,
      position: position++,
      source: raw.source,
      phash: raw.photoHashes[index] ?? null,
    });
    added += 1;
  }
  return added;
}

/** A duplicate adds its source and any new photos to the listing it matches. */
export async function mergeSource(
  db: Db,
  listingId: number,
  raw: RawListing,
  now: string,
): Promise<void> {
  const [row] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!row) return;
  const link = sourceLinkFor(raw, now);
  const known = new Set([...(row.url ? [row.url] : []), ...row.sourceLinks.map((l) => l.url)]);
  const sourceLinks = link && !known.has(link.url) ? [...row.sourceLinks, link] : row.sourceLinks;
  await db.update(listings).set({ sourceLinks, lastChecked: now }).where(eq(listings.id, listingId));
  await insertPhotos(db, listingId, raw);
}

export async function touchListing(db: Db, listingId: number, now: string): Promise<void> {
  await db.update(listings).set({ lastChecked: now }).where(eq(listings.id, listingId));
}

export async function setLocation(
  db: Db,
  listingId: number,
  place: { lat: number; lng: number; address?: string | null; city?: string | null },
): Promise<void> {
  await db
    .update(listings)
    .set({
      lat: place.lat,
      lng: place.lng,
      ...(place.address ? { address: place.address } : {}),
      ...(place.city ? { city: place.city } : {}),
    })
    .where(eq(listings.id, listingId));
}

/** Roommate-wanted posts are leads, not listings. Deduped by post URL, or by text without one. */
export async function saveRoommateLead(
  db: Db,
  raw: RawListing,
  draft: Draft,
  now: string,
): Promise<{ id: number; created: boolean }> {
  const existing = raw.url
    ? await db.select().from(roommateLeads).where(eq(roommateLeads.postUrl, raw.url))
    : await db
        .select()
        .from(roommateLeads)
        .where(and(isNull(roommateLeads.postUrl), eq(roommateLeads.text, raw.text)));
  const found = existing[0];
  if (found) return { id: found.id, created: false };
  const [row] = await db
    .insert(roommateLeads)
    .values({
      source: raw.source,
      postUrl: raw.url,
      posterName: raw.posterName ?? null,
      posterProfileUrl: raw.posterProfileUrl ?? null,
      groupName: raw.groupName ?? null,
      text: raw.text,
      datesWanted: draft.roommate?.datesWanted ?? null,
      budgetCents: draft.roommate?.budgetCents ?? null,
      status: "new",
      createdAt: now,
    })
    .returning({ id: roommateLeads.id });
  if (!row) throw new Error("Roommate lead insert returned no row");
  return { id: row.id, created: true };
}

export async function roommateLeadExists(db: Db, url: string): Promise<boolean> {
  const rows = await db.select({ id: roommateLeads.id }).from(roommateLeads).where(eq(roommateLeads.postUrl, url));
  return rows.length > 0;
}

export type EnrichmentWrite = Partial<Omit<typeof enrichment.$inferInsert, "listingId" | "computedAt">>;

/** Insert or update only the given columns, so recomputing a cost never wipes a commute. */
export async function saveEnrichment(
  db: Db,
  listingId: number,
  values: EnrichmentWrite,
  now: string,
): Promise<void> {
  const [existing] = await db.select({ id: enrichment.listingId }).from(enrichment).where(eq(enrichment.listingId, listingId));
  if (existing) {
    await db.update(enrichment).set({ ...values, computedAt: now }).where(eq(enrichment.listingId, listingId));
  } else {
    await db.insert(enrichment).values({ ...values, listingId, computedAt: now });
  }
}

export async function recordChannelRun(
  db: Db,
  run: {
    channel: (typeof CHANNELS)[number];
    groupName?: string | null;
    itemsSeen: number;
    itemsNew: number;
    error?: string | null;
  },
  now: string,
): Promise<void> {
  await db.insert(channelRuns).values({
    channel: run.channel,
    groupName: run.groupName ?? null,
    ranAt: now,
    itemsSeen: run.itemsSeen,
    itemsNew: run.itemsNew,
    error: run.error ?? null,
  });
}

/** When a channel last ran without an error, or null. */
export async function lastSuccessfulRun(db: Db, channel: (typeof CHANNELS)[number]): Promise<string | null> {
  const rows = await db
    .select({ ranAt: channelRuns.ranAt })
    .from(channelRuns)
    .where(and(eq(channelRuns.channel, channel), isNull(channelRuns.error)))
    .orderBy(desc(channelRuns.ranAt))
    .limit(1);
  return rows[0]?.ranAt ?? null;
}
