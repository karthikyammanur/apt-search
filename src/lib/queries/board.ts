// The board: one card per listing, sorted by bucket then score, in SQL. Every number on a card
// comes from the enrichment and facts tables, which only the domain code and providers fill.

import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { BUCKETS, enrichment, listings, photos, USER_STATUSES } from "@/db/schema";
import { getSettings as readSettings } from "@/db/settings";
import { overBudgetCents, type Bucket, type ExplainItem, type FilterId } from "@/lib/domain";
import { readAnalysis } from "@/lib/intake/analysis";
import { currentValue, dbOf, factRowsFor, type QueryOptions } from "./shared";

export type UserStatus = (typeof USER_STATUSES)[number];

export type BoardFilter = { bucket?: Bucket; status?: UserStatus };

export type BoardItem = {
  id: number;
  title: string | null;
  source: string;
  url: string | null;
  type: "room" | "studio" | "apartment" | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** Null until the listing has been analyzed. */
  bucket: Bucket | null;
  /** 0 to 100. Null when not scored (a cheap filter failed first). */
  score: number | null;
  /** Integer cents. Null when Unknown. */
  allInMonthlyCents: number | null;
  allInPlusTransitCents: number | null;
  rentCents: number | null;
  /** Integer minutes, door to office by transit. */
  commuteMinutes: number | null;
  nearestStop: string | null;
  stopWalkMinutes: number | null;
  rushHeadwayMinutes: number | null;
  hasRoommates: boolean | null;
  photoUrl: string | null;
  photoCount: number;
  /** The top strength and the biggest weakness, from the score breakdown. */
  strength: ExplainItem | null;
  weakness: ExplainItem | null;
  /** "confirm fees with landlord" on a likely listing. */
  likelyReason: string | null;
  /** "scam checks pending" on a likely listing with open checks. */
  scamNote: string | null;
  /** Reason of the first failed filter. */
  failReason: string | null;
  /** Every failed filter, in the order the filters run. Empty unless the listing fails. */
  failedFilters: FilterId[];
  /** How far over the cap the monthly cost is, when the budget filter failed. */
  overBudgetCents: number | null;
  /** True when the listing has no street address and its point is a guess from a place name. */
  approximateLocation: boolean;
  openQuestions: number;
  userStatus: UserStatus;
  userStatusReason: string | null;
  firstSeen: string;
  lastChecked: string | null;
};

export type BucketCounts = Record<Bucket, number> & { unanalyzed: number };

export type Board = { items: BoardItem[]; counts: BucketCounts };

const BUCKET_ORDER = sql`case ${enrichment.bucket} when 'pass' then 0 when 'likely' then 1 when 'needs_info' then 2 when 'fail' then 3 else 4 end`;

/** Cards for the board. Counts cover every bucket under the status filter, so tabs show totals. */
export async function getBoard(filter: BoardFilter = {}, options?: QueryOptions): Promise<Board> {
  const db = dbOf(options);
  const statusWhere = filter.status ? eq(listings.userStatus, filter.status) : undefined;
  const where: SQL | undefined = and(statusWhere, filter.bucket ? eq(enrichment.bucket, filter.bucket) : undefined);

  const rows = await db
    .select({ listing: listings, enrichment })
    .from(listings)
    .leftJoin(enrichment, eq(enrichment.listingId, listings.id))
    .where(where)
    .orderBy(BUCKET_ORDER, sql`${enrichment.score} is null`, desc(enrichment.score), asc(listings.id));

  const countRows = await db
    .select({ bucket: enrichment.bucket, n: sql<number>`count(*)` })
    .from(listings)
    .leftJoin(enrichment, eq(enrichment.listingId, listings.id))
    .where(statusWhere)
    .groupBy(enrichment.bucket);
  const counts: BucketCounts = { pass: 0, likely: 0, needs_info: 0, fail: 0, unanalyzed: 0 };
  for (const row of countRows) {
    if (row.bucket && (BUCKETS as readonly string[]).includes(row.bucket)) counts[row.bucket] += Number(row.n);
    else counts.unanalyzed += Number(row.n);
  }

  const cap = await readSettings(db).then((s) => s.budgetCapCents, () => null);
  const ids = rows.map((row) => row.listing.id);
  const factsBy = await factRowsFor(db, ids);
  const photoRows = ids.length
    ? await db.select().from(photos).where(inArray(photos.listingId, ids)).orderBy(asc(photos.position))
    : [];
  const photosBy = new Map<number, string[]>();
  for (const photo of photoRows) photosBy.set(photo.listingId, [...(photosBy.get(photo.listingId) ?? []), photo.url]);

  const items = rows.map(({ listing, enrichment: e }): BoardItem => {
    const analysis = readAnalysis(e?.costBreakdown);
    const listingFacts = factsBy.get(listing.id);
    const listingPhotos = photosBy.get(listing.id) ?? [];
    const failedResults = analysis?.filters.results.filter((r) => r.status === "fail") ?? [];
    const failed = failedResults[0];
    const failedBudget = failedResults.some((r) => r.filter === "budget");
    return {
      id: listing.id,
      title: listing.title,
      source: listing.source,
      url: listing.url,
      type: listing.type,
      city: listing.city,
      address: listing.address,
      lat: listing.lat,
      lng: listing.lng,
      bucket: e?.bucket ?? null,
      score: e?.score ?? null,
      allInMonthlyCents: e?.allInMonthly ?? null,
      allInPlusTransitCents: e?.allInPlusTransit ?? null,
      rentCents: currentValue<number>(listingFacts, "rentCents"),
      commuteMinutes: e?.commuteTransitMin ?? currentValue<number>(listingFacts, "commuteMinutes"),
      nearestStop: e?.nearestStop ?? null,
      stopWalkMinutes: e?.stopWalkMin ?? null,
      rushHeadwayMinutes: e?.rushHeadwayMin ?? null,
      hasRoommates: currentValue<boolean>(listingFacts, "hasRoommates"),
      photoUrl: listingPhotos[0] ?? null,
      photoCount: listingPhotos.length,
      strength: analysis?.explanation?.strengths[0] ?? null,
      weakness: analysis?.explanation?.weakness ?? null,
      likelyReason: analysis?.filters.likelyReason ?? null,
      scamNote: analysis?.filters.scamNote ?? null,
      failReason: failed?.reason ?? null,
      failedFilters: failedResults.map((r) => r.filter),
      overBudgetCents: failedBudget && analysis && cap !== null ? overBudgetCents(analysis.cost, cap) : null,
      approximateLocation: currentValue<boolean>(listingFacts, "locationApproximate") === true,
      openQuestions: analysis?.filters.questions.length ?? 0,
      userStatus: listing.userStatus,
      userStatusReason: listing.userStatusReason,
      firstSeen: listing.firstSeen,
      lastChecked: listing.lastChecked,
    };
  });
  return { items, counts };
}
