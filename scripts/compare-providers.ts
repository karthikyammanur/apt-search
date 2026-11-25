// `npm run compare:providers`: one side-by-side run of Google against the free providers that replace
// it on Vercel (see docs/deploy.md). It uses the neutral demo listings and the example office from
// config/settings.example.json, and prints numbers only. No keys or personal data.
//
// It uses real free quota (about 60 calls) and takes about 5 minutes, because Overpass is limited
// to 2 requests a minute. Point it at a scratch database so it does not fill your dev cache, and give
// it a database that already has the transit stop table (npm run gtfs) to read stations from:
//   PowerShell:  $env:DATABASE_URL="file:data/compare.db"; npm run db:migrate; npm run compare:providers
// The stop table is read from STOPS_DATABASE_URL, default file:data/dev.db. It is only read.

import { loadEnvConfig } from "@next/env";
import { createDb } from "../src/db";
import { DEMO_LISTINGS } from "../src/db/demo";
import { arriveBy830, loadStops, PLACE_RADIUS_METERS, routeToLegs, type StopRow } from "../src/lib/intake/enrich";
import { createPlaces, type Place } from "../src/lib/intake/geo";
import { bayAreaPack } from "../src/lib/regions";
import { geoapify, google, overpass, transitland, type Coordinates, type Result, type Route } from "../src/lib/providers";

loadEnvConfig(process.cwd());

const COUNT = 6;
// The example office (Palo Alto civic center). The same point the test fixtures use.
const OFFICE: Coordinates = { lat: 37.4419, lng: -122.143 };
const ARRIVE_BY = arriveBy830("2026-12-01"); // a Tuesday, 8:30 am Pacific
const PRODUCTION = { VERCEL: "1", VERCEL_ENV: "production" };

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

/** The transit legs as the app reads them, for display: "vta:21", "caltrain:Palo Alto>Menlo Park". */
function legsText(route: Route, stops: StopRow[]): string {
  const legs = routeToLegs(route, stops).legs.filter((leg) => leg.mode === "transit");
  return legs.length === 0 ? "no transit" : legs.map((l) => `${l.agency ?? "?"}${l.from || l.to ? `:${l.from ?? "?"}>${l.to ?? "?"}` : ""}`).join(" + ");
}

/** What the app would charge for a pass on this route, through the same region pack the app uses. */
function pass(route: Route, stops: StopRow[]): { priced: boolean; dollars: number | null; why: string } {
  const choice = bayAreaPack.cheapestPass(routeToLegs(route, stops));
  return choice.status === "estimate"
    ? { priced: true, dollars: choice.monthlyCents / 100, why: choice.reason }
    : { priced: false, dollars: null, why: choice.reason };
}

const placeKinds = ["grocery_store", "gym", "cafe"] as const;
function placeStats(center: Coordinates, places: Place[]) {
  const stats: Record<string, { count: number; nearestM: number | null }> = {};
  for (const kind of placeKinds) {
    const of = places.filter((p) => p.types.includes(kind));
    const nearest = of.map((p) => distanceMeters(center, p));
    stats[kind] = { count: of.length, nearestM: nearest.length ? Math.min(...nearest) : null };
  }
  return stats;
}

type Row = Record<string, string | number | boolean | null>;
const rows: Row[] = [];

async function main() {
  const stops = await loadStops(createDb(process.env.STOPS_DATABASE_URL || "file:data/dev.db"));
  console.log(`Stop table: ${stops.length} stops, ${stops.filter((s) => s.modes.includes("rail")).length} rail`);
  const homes = DEMO_LISTINGS.filter((l) => l.lat !== null && l.lng !== null && l.address !== null).slice(0, COUNT);

  // Places two ways. Google alone, and the production chain (Overpass, then Geoapify Places), noting who answered.
  const noGoogle = { nearby: async () => ({ ok: false, error: "disabled" }) } as never;
  const noOverpass = { nearby: async () => ({ ok: false, error: "disabled" }) } as never;
  const noGeoapify = { places: async () => ({ ok: false, error: "disabled" }) } as never;
  const googlePlaces = createPlaces({ google, overpass: noOverpass, geoapify: noGeoapify }, {});
  const seen = { overpass: "not asked", geoapify: "not asked" };
  const productionPlaces = createPlaces(
    {
      google: noGoogle,
      overpass: {
        nearby: async (c: Coordinates, r?: number) => {
          const result = await overpass.nearby(c, r);
          seen.overpass = label(result);
          return result;
        },
      } as never,
      geoapify: {
        places: async (c: Coordinates, r?: number) => {
          const result = await geoapify.places(c, r);
          seen.geoapify = label(result);
          return result;
        },
      } as never,
    },
    PRODUCTION,
  );
  console.log(`Comparing ${homes.length} demo listings to the example office, arriving ${ARRIVE_BY}\n`);

  for (const [index, home] of homes.entries()) {
    const here = { lat: home.lat!, lng: home.lng! };
    const tG = await call(() => google.route(here, OFFICE, "TRANSIT", ARRIVE_BY));
    const tF = await call(() => transitland.route(here, OFFICE, ARRIVE_BY));
    const wG = await call(() => google.route(here, OFFICE, "WALK"));
    const wF = await call(() => geoapify.route(here, OFFICE, "WALK"));
    const bG = await call(() => google.route(here, OFFICE, "BICYCLE"));
    const bF = await call(() => geoapify.route(here, OFFICE, "BICYCLE"));
    const pG = await googlePlaces(here, PLACE_RADIUS_METERS);
    if (index > 0) await sleep(35_000); // Overpass: 2 requests a minute
    seen.overpass = "not asked";
    seen.geoapify = "not asked";
    const pF = await productionPlaces(here, PLACE_RADIUS_METERS);

    const tg = okData(tG);
    const tf = okData(tF);
    const passG = tg ? pass(tg, stops) : null;
    const passF = tf ? pass(tf, stops) : null;
    const pgs = pG.ok ? placeStats(here, pG.data) : null;
    const pfs = pF.ok ? placeStats(here, pF.data) : null;
    rows.push({
      listing: index + 1,
      transit_google: tg?.minutes ?? label(tG),
      transit_transitland: tf?.minutes ?? label(tF),
      legs_google: tg ? legsText(tg, stops) : null,
      legs_transitland: tf ? legsText(tf, stops) : null,
      pass_google: passG ? (passG.priced ? passG.dollars : `unknown (${passG.why})`) : null,
      pass_transitland: passF ? (passF.priced ? passF.dollars : `unknown (${passF.why})`) : null,
      walk_google: okData(wG)?.minutes ?? label(wG),
      walk_geoapify: okData(wF)?.minutes ?? label(wF),
      bike_google: okData(bG)?.minutes ?? label(bG),
      bike_geoapify: okData(bF)?.minutes ?? label(bF),
      overpass: seen.overpass,
      geoapify_places: seen.geoapify,
      places_google: pgs ? Object.values(pgs).reduce((n, s) => n + s.count, 0) : label(pG),
      places_free: pfs ? Object.values(pfs).reduce((n, s) => n + s.count, 0) : label(pF),
      grocery_google: pgs?.grocery_store?.count ?? null,
      grocery_free: pfs?.grocery_store?.count ?? null,
      grocery_nearest_google_m: pgs?.grocery_store?.nearestM ?? null,
      grocery_nearest_free_m: pfs?.grocery_store?.nearestM ?? null,
      gym_google: pgs?.gym?.count ?? null,
      gym_free: pfs?.gym?.count ?? null,
      cafe_google: pgs?.cafe?.count ?? null,
      cafe_free: pfs?.cafe?.count ?? null,
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
  const priced = (key: string) => rows.filter((r) => typeof r[key] === "number").length;
  const samePass = rows.filter((r) => typeof r.pass_google === "number" && r.pass_google === r.pass_transitland).length;
  console.log(
    `pass priced: Google ${priced("pass_google")}, Transitland ${priced("pass_transitland")} of ${rows.length}; same price on ${samePass}`,
  );
  console.log(`places answered: Google ${answered("places_google")}, free chain ${answered("places_free")} of ${rows.length}`);
  console.log(
    `free chain answered by: Overpass ${rows.filter((r) => r.overpass === "ok").length}, Geoapify Places ${rows.filter((r) => r.geoapify_places === "ok").length} (after Overpass failed)`,
  );
  const sum = (key: string) => rows.reduce((total, r) => total + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
  console.log(`places found, all listings: grocery ${sum("grocery_google")} vs ${sum("grocery_free")}, gym ${sum("gym_google")} vs ${sum("gym_free")}, cafe ${sum("cafe_google")} vs ${sum("cafe_free")} (Google vs free chain)`);
}

main().catch((error: unknown) => {
  console.error("Comparison failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
