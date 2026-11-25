// One listing, fully checked: facts with provenance, cost lines, filter results with reasons,
// commute legs, nearby stops and places, scam checks, photos and sources. Plus a side-by-side
// comparison built from the same data.

import { asc, eq, inArray } from "drizzle-orm";
import { pickCurrentFact } from "@/db/facts";
import { enrichment, listings, photos, roommates, transitStops } from "@/db/schema";
import type { SourceLink } from "@/db/source-links";
import {
  SCAM_CHECK_IDS,
  type Bucket,
  type CostLine,
  type Explanation,
  type FilterResult,
  type ListingFactValues,
  type Question,
  type ScamCheckId,
  type ScamChecks,
  type ScoreBreakdown,
} from "@/lib/domain";
import { readAnalysis, type StoredCost } from "@/lib/intake/analysis";
import type { ScamCheckDetail } from "@/lib/intake/types";
import { dbOf, factRowsFor, type FactRow, type QueryOptions } from "./shared";
import type { UserStatus } from "./board";

export type FactEntry = {
  field: string;
  /** The value in use (highest-priority known row), or null when Unknown. */
  current: FactRow | null;
  /** Every source's reading of this field, so a landlord's answer and the post can be compared. */
  rows: FactRow[];
};

export type NearbyStopDetail = {
  name: string | null;
  walkMinutes: number;
  rushHeadwayMinutes: number | null;
  regionalRail: boolean;
  /** From transit_stops: "current_schedule" means show "based on current schedule". Null when not recorded. */
  scheduleBasis: "target_date" | "current_schedule" | null;
  scheduleDate: string | null;
};

export type Poi = { name: string; walkMinutes: number; provenance: "api" | "estimate" };

export type TrustCheck = {
  id: ScamCheckId;
  /** pass, fail, resolved (cleared by me), or null when not checked yet. */
  status: "pass" | "fail" | "resolved" | null;
  /** Why the automatic check gave this result. Null when it left no reason. */
  reason: string | null;
};

export type ListingDetail = {
  listing: {
    id: number;
    title: string | null;
    source: string;
    url: string | null;
    type: "room" | "studio" | "apartment" | null;
    postType: string;
    address: string | null;
    city: string | null;
    lat: number | null;
    lng: number | null;
    groupName: string | null;
    posterProfileUrl: string | null;
    rawText: string | null;
    status: string;
    userStatus: UserStatus;
    userStatusReason: string | null;
    firstSeen: string;
    lastChecked: string | null;
  };
  facts: Record<string, FactEntry>;
  bucket: Bucket | null;
  score: number | null;
  /** Integer cents. */
  allInMonthlyCents: number | null;
  allInPlusTransitCents: number | null;
  cost: {
    lines: CostLine[];
    transitPass: StoredCost["transitPass"];
    stay: StoredCost["stay"];
    /** Refundable deposit plus everything due at signing, in cents. Null when any part is Unknown. */
    upfrontCashCents: number | null;
    upfrontLines: StoredCost["upfrontLines"];
  } | null;
  filters: {
    results: FilterResult[];
    questions: Question[];
    likelyReason: string | null;
    scamNote: string | null;
  } | null;
  scoreBreakdown: ScoreBreakdown | null;
  explanation: Explanation | null;
  commute: {
    transitMinutes: number | null;
    bikeMinutes: number | null;
    /** Legs as stored in the commuteRoute fact (mode, agency, from, to). */
    legs: ListingFactValues["commuteRoute"]["legs"];
    /** Raw route steps from the routing provider (mode, line name, minutes). */
    steps: unknown[];
  };
  transit: {
    nearestStop: string | null;
    stopWalkMinutes: number | null;
    rushHeadwayMinutes: number | null;
    stops: NearbyStopDetail[];
  };
  /** `notChecked` lists the kinds (grocery_store, gym, cafe) the place source could not vouch for. */
  places: { grocery: Poi | null; gym: Poi | null; cafes: Poi[]; notChecked: string[] } | null;
  trust: TrustCheck[];
  photos: { url: string; position: number; source: string }[];
  /** Every place this listing was seen. */
  sources: SourceLink[];
  roommates: { id: number; name: string; status: string; notes: string | null }[];
  computedAt: string | null;
};

function groupFacts(byField: Map<string, FactRow[]> | undefined): Record<string, FactEntry> {
  const out: Record<string, FactEntry> = {};
  for (const [field, rows] of byField ?? []) out[field] = { field, current: pickCurrentFact(rows), rows };
  return out;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function scheduleByName(db: ReturnType<typeof dbOf>, names: string[]) {
  const out = new Map<string, { basis: NearbyStopDetail["scheduleBasis"]; date: string | null }>();
  if (names.length === 0) return out;
  const rows = await db
    .select({ name: transitStops.name, basis: transitStops.scheduleBasis, date: transitStops.scheduleDate })
    .from(transitStops)
    .where(inArray(transitStops.name, names));
  for (const row of rows) {
    const seen = out.get(row.name);
    // Any platform counted on a fallback day makes the stop "based on current schedule".
    if (!seen || (row.basis === "current_schedule" && seen.basis !== "current_schedule")) {
      out.set(row.name, { basis: row.basis, date: row.date });
    }
  }
  return out;
}

function trustChecks(current: ScamChecks | null, stored: unknown): TrustCheck[] {
  const details = asArray<ScamCheckDetail>((stored as { details?: unknown } | null)?.details);
  return SCAM_CHECK_IDS.map((id) => ({
    id,
    status: current?.[id] ?? null,
    reason: details.find((d) => d.id === id)?.reason ?? null,
  }));
}

/** Full detail for one listing, or null when there is no such listing. */
export async function getListing(id: number, options?: QueryOptions): Promise<ListingDetail | null> {
  const db = dbOf(options);
  const [listing] = await db.select().from(listings).where(eq(listings.id, id));
  if (!listing) return null;
  const [e] = await db.select().from(enrichment).where(eq(enrichment.listingId, id));
  const facts = groupFacts((await factRowsFor(db, [id])).get(id));
  const analysis = readAnalysis(e?.costBreakdown);
  const value = <T>(field: string): T | null => (facts[field]?.current?.value as T | undefined) ?? null;

  const stopsFact = asArray<{ name?: string; walkMinutes: number; rushHeadwayMinutes: number | null; regionalRail: boolean }>(
    value("nearbyStops"),
  );
  const schedule = await scheduleByName(db, stopsFact.flatMap((s) => (s.name ? [s.name] : [])));
  const pois = e?.pois as { grocery?: Poi | null; gym?: Poi | null; cafes?: Poi[]; notChecked?: string[] } | null | undefined;
  const photoRows = await db.select().from(photos).where(eq(photos.listingId, id)).orderBy(asc(photos.position));
  const people = await db.select().from(roommates).where(eq(roommates.listingId, id));
  const primary: SourceLink[] = listing.url && !listing.sourceLinks.some((l) => l.url === listing.url)
    ? [{ source: listing.source, url: listing.url, seen_at: listing.firstSeen }]
    : [];

  return {
    listing: {
      id: listing.id,
      title: listing.title,
      source: listing.source,
      url: listing.url,
      type: listing.type,
      postType: listing.postType,
      address: listing.address,
      city: listing.city,
      lat: listing.lat,
      lng: listing.lng,
      groupName: listing.groupName,
      posterProfileUrl: listing.posterProfileUrl,
      rawText: listing.rawText,
      status: listing.status,
      userStatus: listing.userStatus,
      userStatusReason: listing.userStatusReason,
      firstSeen: listing.firstSeen,
      lastChecked: listing.lastChecked,
    },
    facts,
    bucket: e?.bucket ?? analysis?.bucket ?? null,
    score: e?.score ?? analysis?.score?.score ?? null,
    allInMonthlyCents: e?.allInMonthly ?? null,
    allInPlusTransitCents: e?.allInPlusTransit ?? null,
    cost: analysis
      ? {
          lines: analysis.cost.lines,
          transitPass: analysis.cost.transitPass,
          stay: analysis.cost.stay,
          upfrontCashCents: analysis.cost.upfrontCashCents,
          upfrontLines: analysis.cost.upfrontLines,
        }
      : null,
    filters: analysis
      ? {
          results: analysis.filters.results,
          questions: analysis.filters.questions,
          likelyReason: analysis.filters.likelyReason ?? null,
          scamNote: analysis.filters.scamNote ?? null,
        }
      : null,
    scoreBreakdown: analysis?.score ?? null,
    explanation: analysis?.explanation ?? null,
    commute: {
      transitMinutes: e?.commuteTransitMin ?? value<number>("commuteMinutes"),
      bikeMinutes: e?.commuteBikeMin ?? null,
      legs: value<ListingFactValues["commuteRoute"]>("commuteRoute")?.legs ?? [],
      steps: asArray(e?.routeSteps),
    },
    transit: {
      nearestStop: e?.nearestStop ?? null,
      stopWalkMinutes: e?.stopWalkMin ?? null,
      rushHeadwayMinutes: e?.rushHeadwayMin ?? null,
      stops: stopsFact.map((stop) => ({
        name: stop.name ?? null,
        walkMinutes: stop.walkMinutes,
        rushHeadwayMinutes: stop.rushHeadwayMinutes,
        regionalRail: stop.regionalRail,
        scheduleBasis: (stop.name && schedule.get(stop.name)?.basis) || null,
        scheduleDate: (stop.name && schedule.get(stop.name)?.date) || null,
      })),
    },
    places: pois
      ? { grocery: pois.grocery ?? null, gym: pois.gym ?? null, cafes: pois.cafes ?? [], notChecked: pois.notChecked ?? [] }
      : null,
    trust: trustChecks(value<ScamChecks>("scamChecks"), e?.scamChecks ?? null),
    photos: photoRows.map((p) => ({ url: p.url, position: p.position, source: p.source })),
    sources: [...primary, ...listing.sourceLinks],
    roommates: people.map((p) => ({ id: p.id, name: p.name, status: p.status, notes: p.notes })),
    computedAt: e?.computedAt ?? null,
  };
}

export type CompareValue = string | number | boolean | null;

export type CompareRow = {
  key: string;
  label: string;
  /** One value per listing, in the order the listings were asked for. Null is Unknown. */
  values: CompareValue[];
  /** True when the known values are not all the same, or some are Unknown and some are not. */
  differs: boolean;
};

export type Comparison = { listings: ListingDetail[]; missing: number[]; rows: CompareRow[] };

const FILTER_LABELS: Record<string, string> = {
  budget: "Budget",
  move_in: "Move-in",
  lease: "Lease",
  commute: "Commute",
  transit_access: "Transit access",
  private_bed_bath: "Private bed and bath",
  furnished: "Furnished",
  scam_checks: "Scam checks",
  roommates: "Roommates",
};

function row(key: string, label: string, values: CompareValue[]): CompareRow {
  const distinct = new Set(values.map((v) => JSON.stringify(v)));
  return { key, label, values, differs: distinct.size > 1 };
}

/** Two to four listings side by side, on the same rows as the detail page. */
export async function compareListings(ids: number[], options?: QueryOptions): Promise<Comparison> {
  const unique = [...new Set(ids)];
  const found: ListingDetail[] = [];
  const missing: number[] = [];
  for (const id of unique) {
    const detail = await getListing(id, options);
    if (detail) found.push(detail);
    else missing.push(id);
  }
  const fact = (d: ListingDetail, field: string): CompareValue => (d.facts[field]?.current?.value as CompareValue) ?? null;
  const rows: CompareRow[] = [
    row("bucket", "Bucket", found.map((d) => d.bucket)),
    row("score", "Fit score", found.map((d) => d.score)),
    row("all_in", "All-in monthly (cents)", found.map((d) => d.allInMonthlyCents)),
    row("all_in_plus_transit", "All-in plus transit (cents)", found.map((d) => d.allInPlusTransitCents)),
    row("rent", "Rent (cents)", found.map((d) => fact(d, "rentCents"))),
    row("commute", "Transit commute (min)", found.map((d) => d.commute.transitMinutes)),
    row("nearest_stop", "Nearest stop", found.map((d) => d.transit.nearestStop)),
    row("stop_walk", "Walk to stop (min)", found.map((d) => d.transit.stopWalkMinutes)),
    row("rush_headway", "Rush-hour headway (min)", found.map((d) => d.transit.rushHeadwayMinutes)),
    row("available_from", "Available from", found.map((d) => fact(d, "availableFrom"))),
    row("lease_type", "Lease type", found.map((d) => fact(d, "leaseType"))),
    row("lease_end", "Lease end", found.map((d) => fact(d, "leaseEnd"))),
    row("private_bath", "Private bath", found.map((d) => fact(d, "privateBath"))),
    row("furnished", "Furnished", found.map((d) => fact(d, "furnished"))),
    row("has_roommates", "Has roommates", found.map((d) => fact(d, "hasRoommates"))),
    ...Object.entries(FILTER_LABELS).map(([filter, label]) =>
      row(`filter_${filter}`, label, found.map((d) => d.filters?.results.find((r) => r.filter === filter)?.status ?? null)),
    ),
  ];
  return { listings: found, missing, rows };
}
