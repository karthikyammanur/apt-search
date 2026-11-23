// Stage: geocode and enrich. Only listings that survived the cheap filters get here, so the
// map quota is not spent on a place that already failed.
//
// Everything numeric comes from a routing API, the stop table or the places API. Where a number
// is a straight-line estimate it is stored with provenance `estimate`. Walking time is computed
// by the routing API for the nearest place of each type only; the rest use the straight-line
// estimate. A failed call leaves the field Unknown. Nothing is defaulted to 0.

import { transitStops } from "@/db/schema";
import type { Db } from "@/db";
import { nearestStops } from "@/lib/transit";
import type { ListingFactValues } from "@/lib/domain";
import type { Route } from "@/lib/providers";
import type { Geo, Place } from "./geo";
import type { FactWrite } from "./facts";

export const WALK_METERS_PER_MINUTE = 80;
/** Straight-line distance understates a walk. 1.3 is a common street-grid detour factor. */
export const DETOUR_FACTOR = 1.3;
export const STOP_RADIUS_METERS = 1200;
export const PLACE_RADIUS_METERS = 1500;
/** If no stop is within this far, the stop table probably does not cover the area. */
export const STOP_COVERAGE_METERS = 15_000;
const MAX_STOPS = 5;
const MAX_CAFES = 5;
const ARRIVE_HOUR_MINUTE = "08:30:00";
const TIME_ZONE = "America/Los_Angeles";

export type StopRow = {
  stopId: string;
  feed: string;
  name: string;
  lat: number;
  lng: number;
  modes: string[];
  medianRushHeadwayMin: number | null;
};

export async function loadStops(db: Db): Promise<StopRow[]> {
  const rows = await db.select().from(transitStops);
  return rows.map((row) => ({
    stopId: row.stopId,
    feed: row.feed,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    modes: row.modes,
    medianRushHeadwayMin: row.medianRushHeadwayMin,
  }));
}

export function estimateWalkMinutes(straightLineMeters: number): number {
  return Math.max(1, Math.ceil((straightLineMeters * DETOUR_FACTOR) / WALK_METERS_PER_MINUTE));
}

/** First weekday on or after the start date (Mon to Fri). Dates are ISO strings. */
export function firstWeekdayOnOrAfter(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** 8:30 am California time on that date, with the offset for that date (PST or PDT). */
export function arriveBy830(isoDate: string): string {
  const noon = new Date(`${isoDate}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "longOffset" })
    .formatToParts(noon)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part ?? "");
  const offset = match ? `${match[1]}${match[2]}:${match[3] ?? "00"}` : "-08:00";
  return `${isoDate}T${ARRIVE_HOUR_MINUTE}${offset}`;
}

const AGENCY_WORDS: [RegExp, string][] = [
  [/caltrain/i, "caltrain"],
  [/\bvta\b/i, "vta"],
  [/samtrans/i, "samtrans"],
  [/marguerite|stanford/i, "marguerite"],
];

/**
 * Route steps from the routing provider carry a mode and a line name, but no agency or station
 * names. The agency is inferred from the line name when it says so. Stop names stay null, so a
 * Caltrain fare zone stays Unknown rather than guessed.
 */
export function routeToLegs(route: Route): ListingFactValues["commuteRoute"] {
  const legs = route.steps.flatMap((step) => {
    const mode =
      step.mode.toUpperCase() === "WALK"
        ? ("walk" as const)
        : step.mode.toUpperCase() === "BICYCLE"
          ? ("bike" as const)
          : step.mode.toUpperCase() === "TRANSIT"
            ? ("transit" as const)
            : null;
    if (!mode) return [];
    const agency = AGENCY_WORDS.find(([pattern]) => pattern.test(step.lineName ?? ""))?.[1] ?? null;
    return [{ mode, agency, from: null, to: null }];
  });
  return { legs };
}

/** "123 Main St, Palo Alto, CA 94301, USA" gives "Palo Alto". Null when it cannot tell. */
export function cityFromFormatted(formatted: string): string | null {
  const match = /,\s*([^,]+),\s*CA\b/.exec(formatted);
  return match?.[1]?.trim() || null;
}

/** An address with a street number or an intersection can be geocoded to one place. */
export function isGeocodable(address: string | null): address is string {
  return address !== null && (/^\s*\d/.test(address) || /\s(?:&|and|at)\s/i.test(address));
}

type Timed = { minutes: number; provenance: "api" | "estimate" };

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export type PoiResult = { name: string; walkMinutes: number; provenance: "api" | "estimate" };

export type EnrichInput = {
  lat: number;
  lng: number;
  office: { lat: number; lng: number };
  startDate: string;
  stops: StopRow[];
};

export type EnrichResult = {
  facts: FactWrite[];
  /** Columns for the enrichment table. */
  columns: {
    commuteTransitMin: number | null;
    routeSteps: Route["steps"] | null;
    commuteBikeMin: number | null;
    nearestStop: string | null;
    stopWalkMin: number | null;
    rushHeadwayMin: number | null;
    pois: { grocery: PoiResult | null; gym: PoiResult | null; cafes: PoiResult[] } | null;
  };
  notes: string[];
};

async function walkingTo(geo: Geo, from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<Timed> {
  const route = await geo.walkBike(from, to, "WALK");
  if (route.ok) return { minutes: route.data.minutes, provenance: "api" };
  return { minutes: estimateWalkMinutes(distanceMeters(from, to)), provenance: "estimate" };
}

function nearestOfType(places: Place[], type: string, from: { lat: number; lng: number }): (Place & { meters: number })[] {
  return places
    .filter((p) => p.types.includes(type))
    .map((p) => ({ ...p, meters: distanceMeters(from, p) }))
    .sort((a, b) => a.meters - b.meters);
}

/** One listing, already geocoded: commute, bike, nearby stops and places. */
export async function enrichListing(geo: Geo, input: EnrichInput): Promise<EnrichResult> {
  const here = { lat: input.lat, lng: input.lng };
  const facts: FactWrite[] = [];
  const notes: string[] = [];
  const columns: EnrichResult["columns"] = {
    commuteTransitMin: null,
    routeSteps: null,
    commuteBikeMin: null,
    nearestStop: null,
    stopWalkMin: null,
    rushHeadwayMin: null,
    pois: null,
  };

  // Transit commute, arriving 8:30 am on the first weekday on or after the start date.
  const arriveBy = arriveBy830(firstWeekdayOnOrAfter(input.startDate));
  const transit = await geo.transit(here, input.office, arriveBy);
  if (transit.ok) {
    columns.commuteTransitMin = transit.data.minutes;
    columns.routeSteps = transit.data.steps;
    facts.push({ field: "commuteMinutes", value: transit.data.minutes, provenance: "api" });
    facts.push({ field: "commuteRoute", value: routeToLegs(transit.data), provenance: "api" });
  } else {
    notes.push(`transit commute: ${transit.error}`);
  }

  const bike = await geo.walkBike(here, input.office, "BICYCLE");
  if (bike.ok) columns.commuteBikeMin = bike.data.minutes;
  else notes.push(`bike commute: ${bike.error}`);

  // Nearby stops from the stop table. The nearest gets a routed walk, the rest an estimate.
  if (input.stops.length === 0) {
    notes.push("stop table is empty, run npm run gtfs");
  } else {
    const close = nearestStops(here.lat, here.lng, STOP_RADIUS_METERS, input.stops);
    const distinct: typeof close = [];
    for (const stop of close) {
      if (!distinct.some((s) => s.name === stop.name)) distinct.push(stop);
      if (distinct.length === MAX_STOPS) break;
    }
    const covered = distinct.length > 0 || nearestStops(here.lat, here.lng, STOP_COVERAGE_METERS, input.stops).length > 0;
    if (covered) {
      const entries: ListingFactValues["nearbyStops"] = [];
      let anyEstimate = false;
      for (const [index, stop] of distinct.entries()) {
        const timed: Timed =
          index === 0
            ? await walkingTo(geo, here, stop)
            : { minutes: estimateWalkMinutes(stop.distanceMeters), provenance: "estimate" };
        if (timed.provenance === "estimate") anyEstimate = true;
        entries.push({
          name: stop.name,
          walkMinutes: timed.minutes,
          rushHeadwayMinutes: stop.medianRushHeadwayMin,
          regionalRail: stop.modes.includes("rail"),
        });
      }
      facts.push({ field: "nearbyStops", value: entries, provenance: anyEstimate ? "estimate" : "api" });
      const first = entries[0];
      if (first) {
        columns.nearestStop = first.name ?? null;
        columns.stopWalkMin = first.walkMinutes;
        columns.rushHeadwayMin = first.rushHeadwayMinutes;
      }
    } else {
      notes.push("no stop data near this address");
    }
  }

  // Grocery, gym and cafes.
  const found = await geo.places(here, PLACE_RADIUS_METERS);
  if (!found.ok) {
    notes.push(`places: ${found.error}`);
  } else {
    const grocery = nearestOfType(found.data, "grocery_store", here)[0];
    const gym = nearestOfType(found.data, "gym", here)[0];
    const cafes = nearestOfType(found.data, "cafe", here).slice(0, MAX_CAFES);
    const poi = async (place: (Place & { meters: number }) | undefined): Promise<PoiResult | null> => {
      if (!place) return null;
      const timed = await walkingTo(geo, here, place);
      return { name: place.name, walkMinutes: timed.minutes, provenance: timed.provenance };
    };
    const groceryPoi = await poi(grocery);
    const gymPoi = await poi(gym);
    const cafePois: PoiResult[] = [];
    for (const [index, cafe] of cafes.entries()) {
      cafePois.push(
        index === 0
          ? ((await poi(cafe)) as PoiResult)
          : { name: cafe.name, walkMinutes: estimateWalkMinutes(cafe.meters), provenance: "estimate" },
      );
    }
    columns.pois = { grocery: groceryPoi, gym: gymPoi, cafes: cafePois };
    if (groceryPoi) facts.push({ field: "groceryWalkMinutes", value: groceryPoi.walkMinutes, provenance: groceryPoi.provenance });
    if (gymPoi) facts.push({ field: "gymWalkMinutes", value: gymPoi.walkMinutes, provenance: gymPoi.provenance });
    // An empty list means none were found, which is a result of its own, but only an estimate.
    facts.push({
      field: "cafeWalkMinutes",
      value: cafePois.map((c) => c.walkMinutes),
      provenance: cafePois.length === 1 && cafePois[0]?.provenance === "api" ? "api" : "estimate",
    });
  }
  return { facts, columns, notes };
}
