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
import { routedByNote, type ListingFactValues } from "@/lib/domain";
import type { Route, StopPoint } from "@/lib/providers";
import { caltrainZone, type RegionPack } from "@/lib/regions";
import type { Geo, Place, PlaceKind } from "./geo";
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

/** "California Avenue Train Station" gives "California Avenue", the name the fare zone table knows. */
export function stationName(name: string | null | undefined): string | null {
  const cleaned = name?.replace(/\b(?:caltrain\s+)?(?:train\s+)?station\b/gi, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

/** How near a boarding or alighting point must be to a station in the stop table to count as that station. */
export const STATION_MATCH_METERS = 300;

/**
 * The Caltrain station a routing provider's boarding or alighting point stands for. Providers that
 * name no stops (or name them differently) still give a stop id or coordinates, so match the stop id
 * against the stop table first, then the nearest station within 300 m. Only stations the fare zone
 * table knows can match, so an unlisted station stays Unknown rather than guessed.
 */
export function caltrainStationFor(point: StopPoint | null | undefined, stops: readonly StopRow[]): string | null {
  if (!point) return null;
  const stations = stops.filter((stop) => stop.modes.includes("rail") && caltrainZone(stop.name) !== null);
  const byId = point.stopId ? stations.find((stop) => stop.stopId === point.stopId) : undefined;
  if (byId) return byId.name;
  if (point.lat === null || point.lng === null) return null;
  return nearestStops(point.lat, point.lng, STATION_MATCH_METERS, stations)[0]?.name ?? null;
}

/**
 * Turn the routing provider's steps into legs. A transit step's agency is the provider's agency
 * name when it gives one, else inferred from the line name. Boarding and alighting stop names
 * come from the provider, so a Caltrain fare zone can be priced; for a Caltrain leg the stop table
 * is asked first (see caltrainStationFor). Without a name the zone stays Unknown rather than guessed.
 */
export function routeToLegs(route: Route, stops: readonly StopRow[] = []): ListingFactValues["commuteRoute"] {
  type Leg = ListingFactValues["commuteRoute"]["legs"][number];
  const legs = route.steps.flatMap((step): Leg[] => {
    const mode =
      step.mode.toUpperCase() === "WALK"
        ? ("walk" as const)
        : step.mode.toUpperCase() === "BICYCLE"
          ? ("bike" as const)
          : step.mode.toUpperCase() === "TRANSIT"
            ? ("transit" as const)
            : null;
    if (!mode) return [];
    if (mode !== "transit") return [{ mode, agency: null, from: null, to: null }];
    const named = (text: string | null | undefined) => AGENCY_WORDS.find(([pattern]) => pattern.test(text ?? ""))?.[1] ?? null;
    const agency = named(step.agencyName) ?? named(step.lineName);
    const caltrain = agency === "caltrain";
    return [
      {
        mode,
        agency,
        from: (caltrain ? caltrainStationFor(step.departurePoint, stops) : null) ?? stationName(step.departureStop),
        to: (caltrain ? caltrainStationFor(step.arrivalPoint, stops) : null) ?? stationName(step.arrivalStop),
      },
    ];
  });
  return { legs };
}

export type RouteChoice = {
  route: Route;
  /** Set when a slower route was taken for its cheaper pass: what was chosen and what it saved. */
  note: string | null;
};

/**
 * Among the fastest itinerary and the ones within five minutes of it, take the one whose monthly pass is
 * cheapest. A route whose pass cannot be priced never beats one that can. Ties go to the faster route, so
 * with no region pack, or no alternatives, the answer is the fastest. The commute minutes and the pass cost
 * both come from the route returned, so the page can say which route they are based on.
 */
export function chooseRoute(
  route: Route,
  region: Pick<RegionPack, "cheapestPass"> | undefined,
  stops: readonly StopRow[] = [],
): RouteChoice {
  const alternatives = route.alternatives ?? [];
  if (!region || alternatives.length === 0) return { route, note: null };
  const priced = [route, ...alternatives].map((candidate) => {
    const pass = region.cheapestPass(routeToLegs(candidate, stops));
    return { candidate, cents: pass.status === "estimate" ? pass.monthlyCents : null };
  });
  let best = priced[0]!;
  for (const entry of priced.slice(1)) {
    if (entry.cents === null) continue;
    if (best.cents === null || entry.cents < best.cents) best = entry;
  }
  if (best.candidate === route) return { route, note: null };
  const chosen: Route = { minutes: best.candidate.minutes, steps: best.candidate.steps };
  const saved = best.cents !== null && priced[0]!.cents !== null ? priced[0]!.cents - best.cents : null;
  const slower = best.candidate.minutes - route.minutes;
  return {
    route: chosen,
    note: `Chosen for the cheaper pass${saved !== null ? `, $${Math.round(saved / 100)} a month less` : ""}; ${slower} min slower than the fastest route`,
  };
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
  /** When given, the route with the cheapest pass is preferred among those within five minutes of the fastest. */
  region?: Pick<RegionPack, "cheapestPass">;
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
    pois: { grocery: PoiResult | null; gym: PoiResult | null; cafes: PoiResult[]; notChecked: PlaceKind[] } | null;
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
    const choice = chooseRoute(transit.data, input.region, input.stops);
    columns.commuteTransitMin = choice.route.minutes;
    columns.routeSteps = choice.route.steps;
    facts.push({ field: "commuteMinutes", value: choice.route.minutes, provenance: "api", note: routedByNote(transit.data.provider) });
    facts.push({ field: "commuteRoute", value: routeToLegs(choice.route, input.stops), provenance: "api", note: choice.note });
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
    // A free source that found none of a kind cannot say there is none: that kind is "not checked", never 0.
    const notChecked = (found.data.notChecked ?? []).filter((kind) => !found.data.some((p) => p.types.includes(kind)));
    columns.pois = { grocery: groceryPoi, gym: gymPoi, cafes: cafePois, notChecked };
    if (groceryPoi) facts.push({ field: "groceryWalkMinutes", value: groceryPoi.walkMinutes, provenance: groceryPoi.provenance });
    if (gymPoi) facts.push({ field: "gymWalkMinutes", value: gymPoi.walkMinutes, provenance: gymPoi.provenance });
    // An empty list means none were found, which is a result of its own, but only an estimate.
    // It is written only when the source could have found cafes at all.
    if (!notChecked.includes("cafe")) {
      facts.push({
        field: "cafeWalkMinutes",
        value: cafePois.map((c) => c.walkMinutes),
        provenance: cafePois.length === 1 && cafePois[0]?.provenance === "api" ? "api" : "estimate",
      });
    }
  }
  return { facts, columns, notes };
}
