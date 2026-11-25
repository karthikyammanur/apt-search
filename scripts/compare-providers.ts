// `npm run compare:providers`: one side-by-side run of Google against the free providers that replace
// it on Vercel production (see docs/deploy.md). It uses the neutral demo listings and the example
// office from config/settings.example.json, and prints numbers only. No keys or personal data.
//
// It uses real free quota (about 60 calls) and takes about 5 minutes, because Overpass is limited
// to 2 requests a minute. Point it at a scratch database so it does not fill your dev cache:
//   PowerShell:  $env:DATABASE_URL="file:data/compare.db"; npm run db:migrate; npm run compare:providers

import { loadEnvConfig } from "@next/env";
import { DEMO_LISTINGS } from "../src/db/demo";
import { arriveBy830, PLACE_RADIUS_METERS, routeToLegs } from "../src/lib/intake/enrich";
import { createPlaces, type Place } from "../src/lib/intake/geo";
import { geoapify, google, overpass, transitland, type Coordinates, type Result, type Route } from "../src/lib/providers";

loadEnvConfig(process.cwd());

const COUNT = 6;
// The example office (Palo Alto civic center). The same point the test fixtures use.
const OFFICE: Coordinates = { lat: 37.4419, lng: -122.143 };
const ARRIVE_BY = arriveBy830("2026-12-01"); // a Tuesday, 8:30 am Pacific

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Call a provider; if it says "rate_limited" wait out the minute window and try once more. */
async function call<T>(run: () => Promise<Result<T>>): Promise<Result<T>> {
  const first = await run();
  if (first.ok || first.error !== "rate_limited") return first;
  await sleep(61_000);
  return run();
}

const distanceMeters = (a: Coordinates, b: Coordinates) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h))));
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const okData = <T>(r: Result<T>): T | null => (r.ok ? r.data : null);
const label = (r: Result<unknown>) => (r.ok ? "ok" : r.error);

/** Does the first transit leg name its agency and both stations? That is what prices a Caltrain zone. */
function pricesZone(route: Route): boolean {
  const legs = routeToLegs(route).legs.filter((leg) => leg.mode === "transit");
  return legs.some((leg) => leg.agency !== null && leg.from !== null && leg.to !== null);
}

const placeKinds = ["grocery_store", "gym", "cafe"] as const;
function placeStats(center: Coordinates, places: Place[]) {
  const stats: Record<string, { count: number; nearestM: number | null }> = {};
  for (const kind of placeKinds) {
    const of = places.filter((p) => p.types.includes(kind));
    const nearest = of.map((p) => distanceMeters(center, p));
    stats[kind] = { count: of.length, nearestM: nearest.length ? Math.min(...nearest) : null };
  }
  return { stats, rated: places.filter((p) => p.rating !== null).length, total: places.length };
}

type Row = Record<string, string | number | null>;
const rows: Row[] = [];

async function main() {
  const homes = DEMO_LISTINGS.filter((l) => l.lat !== null && l.lng !== null && l.address !== null).slice(0, COUNT);
  const googlePlaces = createPlaces({ google, overpass: { nearby: async () => ({ ok: false, error: "disabled" }) } as never }, {});
  const freePlaces = createPlaces({ google: { nearby: async () => ({ ok: false, error: "disabled" }) } as never, overpass }, { VERCEL: "1", VERCEL_ENV: "production" });
  console.log(`Comparing ${homes.length} demo listings to the example office, arriving ${ARRIVE_BY}\n`);

  for (const [index, home] of homes.entries()) {
    const here = { lat: home.lat!, lng: home.lng! };
    const tG = await call(() => google.route(here, OFFICE, "TRANSIT", ARRIVE_BY));
    const tF = await call(() => transitland.route(here, OFFICE, ARRIVE_BY));
    const wG = await call(() => google.route(here, OFFICE, "WALK"));
    const wF = await call(() => geoapify.route(here, OFFICE, "WALK"));
    const bG = await call(() => google.route(here, OFFICE, "BICYCLE"));
    const bF = await call(() => geoapify.route(here, OFFICE, "BICYCLE"));
    const gG = await call(() => google.geocode(home.address!));
    const gF = await call(() => geoapify.geocode(home.address!));
    const pG = await googlePlaces(here, PLACE_RADIUS_METERS);
    if (index > 0) await sleep(35_000); // Overpass: 2 requests a minute
    const pF = await freePlaces(here, PLACE_RADIUS_METERS);

    const ps = (r: Result<Place[]>) => (r.ok ? placeStats(here, r.data) : null);
    const pgs = ps(pG);
    const pfs = ps(pF);
    const tg = okData(tG);
    const tf = okData(tF);
    const geoG = okData(gG);
    const geoF = okData(gF);
    rows.push({
      listing: index + 1,
      transit_google: tg?.minutes ?? label(tG),
      transit_transitland: tf?.minutes ?? label(tF),
      zone_priced_google: tg ? (pricesZone(tg) ? 1 : 0) : null,
      zone_priced_transitland: tf ? (pricesZone(tf) ? 1 : 0) : null,
      walk_google: okData(wG)?.minutes ?? label(wG),
      walk_geoapify: okData(wF)?.minutes ?? label(wF),
      bike_google: okData(bG)?.minutes ?? label(bG),
      bike_geoapify: okData(bF)?.minutes ?? label(bF),
      geocode_apart_m: geoG && geoF ? distanceMeters(geoG, geoF) : null,
      geocode_google: label(gG),
      geocode_geoapify: label(gF),
      grocery_google: pgs?.stats.grocery_store?.count ?? label(pG),
      grocery_overpass: pfs?.stats.grocery_store?.count ?? label(pF),
      grocery_nearest_google_m: pgs?.stats.grocery_store?.nearestM ?? null,
      grocery_nearest_overpass_m: pfs?.stats.grocery_store?.nearestM ?? null,
      gym_google: pgs?.stats.gym?.count ?? null,
      gym_overpass: pfs?.stats.gym?.count ?? null,
      cafe_google: pgs?.stats.cafe?.count ?? null,
      cafe_overpass: pfs?.stats.cafe?.count ?? null,
      rated_google: pgs ? `${pgs.rated}/${pgs.total}` : null,
      rated_overpass: pfs ? `${pfs.rated}/${pfs.total}` : null,
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }

  // Summary: only listings where both providers answered are compared.
  const pairs = (a: string, b: string) =>
    rows.flatMap((r) => (typeof r[a] === "number" && typeof r[b] === "number" ? [[r[a] as number, r[b] as number] as const] : []));
  const summarize = (name: string, a: string, b: string) => {
    const p = pairs(a, b);
    const diffs = p.map(([x, y]) => y - x);
    console.log(
      `${name}: ${p.length}/${rows.length} compared, free minus Google: median ${median(diffs)} min, ` +
        `largest gap ${diffs.length ? Math.max(...diffs.map(Math.abs)) : "n/a"} min, within 5 min on ${diffs.filter((d) => Math.abs(d) <= 5).length}`,
    );
  };
  console.log("\nSummary");
  summarize("transit", "transit_google", "transit_transitland");
  summarize("walk", "walk_google", "walk_geoapify");
  summarize("bike", "bike_google", "bike_geoapify");
  const answered = (key: string) => rows.filter((r) => typeof r[key] === "number").length;
  console.log(`transit answered: Google ${answered("transit_google")}, Transitland ${answered("transit_transitland")} of ${rows.length}`);
  console.log(
    `Caltrain zone priceable (agency and both stations named): Google ${rows.filter((r) => r.zone_priced_google === 1).length}, ` +
      `Transitland ${rows.filter((r) => r.zone_priced_transitland === 1).length} of ${rows.length}`,
  );
  console.log(`geocode answered: Google ${rows.filter((r) => r.geocode_google === "ok").length}, Geoapify ${rows.filter((r) => r.geocode_geoapify === "ok").length}; median distance apart ${median(rows.flatMap((r) => (typeof r.geocode_apart_m === "number" ? [r.geocode_apart_m] : [])))} m`);
  console.log(`places answered: Google ${answered("grocery_google")}, Overpass ${answered("grocery_overpass")} of ${rows.length}`);
  const sum = (key: string) => rows.reduce((total, r) => total + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
  console.log(`places found, all listings: grocery ${sum("grocery_google")} vs ${sum("grocery_overpass")}, gym ${sum("gym_google")} vs ${sum("gym_overpass")}, cafe ${sum("cafe_google")} vs ${sum("cafe_overpass")} (Google vs Overpass)`);
}

main().catch((error: unknown) => {
  console.error("Comparison failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
