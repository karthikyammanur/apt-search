// Pricing a Caltrain pass from a routing provider that names no stations: match the boarding and
// alighting points to the nearest Caltrain station in the stop table (by stop id, else within 300 m).

import { describe, expect, it } from "vitest";
import { caltrainStationFor, routeToLegs, STATION_MATCH_METERS, type StopRow } from "@/lib/intake/enrich";
import type { Route } from "@/lib/providers";
import { bayAreaPack } from "@/lib/regions";

const stop = (stopId: string, name: string, lat: number, lng: number, modes: string[]): StopRow => ({
  stopId,
  feed: "511",
  name,
  lat,
  lng,
  modes,
  medianRushHeadwayMin: 15,
});

const STOPS: StopRow[] = [
  stop("mtc:palo-alto-station", "Palo Alto Station", 37.44317, -122.16432, ["rail"]),
  stop("california_ave", "California Avenue", 37.42883, -122.14113, ["rail"]),
  stop("redwood_city", "Redwood City", 37.48586, -122.2315, ["rail"]),
  // Not Caltrain stations: a bus stop next to Palo Alto Station, and a rail stop the zone table does not list.
  stop("PS_PATC", "Palo Alto Transit Center", 37.44399, -122.16629, []),
  stop("other_rail", "Some Other Rail Stop", 37.4455, -122.1649, ["rail"]),
];

const near = (lat: number, lng: number) => ({ stopId: null, lat, lng });
const step = (over: Partial<Route["steps"][number]>): Route["steps"][number] => ({ mode: "TRANSIT", lineName: null, minutes: 10, ...over });
const priceOf = (route: Route) => bayAreaPack.cheapestPass(routeToLegs(route, STOPS));

describe("caltrainStationFor", () => {
  it("matches by stop id first", () => {
    expect(caltrainStationFor({ stopId: "california_ave", lat: null, lng: null }, STOPS)).toBe("California Avenue");
  });

  it("prefers the stop id over a closer station by coordinates", () => {
    const point = { stopId: "redwood_city", lat: 37.44317, lng: -122.16432 }; // standing on Palo Alto Station
    expect(caltrainStationFor(point, STOPS)).toBe("Redwood City");
  });

  it("falls back to the nearest station within 300 m", () => {
    expect(STATION_MATCH_METERS).toBe(300);
    expect(caltrainStationFor(near(37.4445, -122.164), STOPS)).toBe("Palo Alto Station"); // about 150 m
    expect(caltrainStationFor({ stopId: "unknown-id", lat: 37.4445, lng: -122.164 }, STOPS)).toBe("Palo Alto Station");
  });

  it("does not match a point more than 300 m from every station", () => {
    expect(caltrainStationFor(near(37.448, -122.164), STOPS)).toBeNull(); // about 400 m
  });

  it("ignores bus stops and rail stops the fare zone table does not list", () => {
    expect(caltrainStationFor({ stopId: "PS_PATC", lat: null, lng: null }, STOPS)).toBeNull();
    expect(caltrainStationFor({ stopId: "other_rail", lat: null, lng: null }, STOPS)).toBeNull();
    // Right next to the unlisted rail stop, but the nearest listed station is Palo Alto Station.
    expect(caltrainStationFor(near(37.4455, -122.1649), STOPS)).toBe("Palo Alto Station");
  });

  it("says nothing when there is no point, no coordinates or no stop table", () => {
    expect(caltrainStationFor(null, STOPS)).toBeNull();
    expect(caltrainStationFor(undefined, STOPS)).toBeNull();
    expect(caltrainStationFor({ stopId: null, lat: null, lng: null }, STOPS)).toBeNull();
    expect(caltrainStationFor(near(37.44317, -122.16432), [])).toBeNull();
  });
});

describe("pricing a Caltrain pass from points instead of names", () => {
  const caltrain = (from: ReturnType<typeof near>, to: ReturnType<typeof near>): Route => ({
    minutes: 25,
    steps: [step({ lineName: "Local", agencyName: "Caltrain", departurePoint: from, arrivalPoint: to })],
  });

  it("names the stations and prices a 1 zone pass for Palo Alto to California Avenue", () => {
    const route = caltrain(near(37.4445, -122.164), near(37.4291, -122.1412));
    expect(routeToLegs(route, STOPS).legs).toEqual([
      { mode: "transit", agency: "caltrain", from: "Palo Alto Station", to: "California Avenue" },
    ]);
    expect(priceOf(route)).toMatchObject({ status: "estimate", monthlyCents: 9600 });
  });

  it("prices a 2 zone pass when the trip crosses from zone 3 to zone 2", () => {
    const route = caltrain(near(37.4445, -122.164), near(37.4859, -122.2316));
    expect(priceOf(route)).toMatchObject({ status: "estimate", monthlyCents: 15000 });
  });

  it("stays Unknown, not guessed, when no station is near the boarding point", () => {
    const route = caltrain(near(37.5, -122.3), near(37.4291, -122.1412));
    expect(priceOf(route)).toMatchObject({ status: "unknown", reason: expect.stringContaining("Caltrain zone is Unknown") });
  });

  it("still uses the provider's own station name when the stop table has none", () => {
    const named: Route = { minutes: 25, steps: [step({ agencyName: "Caltrain", departureStop: "Palo Alto Caltrain Station", arrivalStop: "California Avenue Train Station" })] };
    expect(routeToLegs(named, []).legs).toEqual([{ mode: "transit", agency: "caltrain", from: "Palo Alto", to: "California Avenue" }]);
    expect(bayAreaPack.cheapestPass(routeToLegs(named, []))).toMatchObject({ status: "estimate", monthlyCents: 9600 });
  });

  it("prefers the stop table over the provider's name", () => {
    const route: Route = {
      minutes: 25,
      steps: [step({ agencyName: "Caltrain", departureStop: "Mystery Stop", arrivalStop: "California Avenue", departurePoint: near(37.4445, -122.164), arrivalPoint: near(37.4291, -122.1412) })],
    };
    expect(routeToLegs(route, STOPS).legs[0]).toMatchObject({ from: "Palo Alto Station", to: "California Avenue" });
  });
});

describe("other agencies price from the agency name alone", () => {
  it("prices a VTA bus from agencyName, which a bare line number cannot tell", () => {
    const route: Route = { minutes: 10, steps: [step({ lineName: "21", agencyName: "VTA" })] };
    expect(priceOf(route)).toMatchObject({ status: "estimate", monthlyCents: 9000 });
  });

  it("is Unknown, not free, when the agency is not named and the line name says nothing", () => {
    const route: Route = { minutes: 10, steps: [step({ lineName: "21" })] };
    expect(priceOf(route)).toMatchObject({ status: "unknown" });
  });

  it("a walk-only route needs no pass", () => {
    const route: Route = { minutes: 20, steps: [step({ mode: "WALK" })] };
    expect(priceOf(route)).toMatchObject({ status: "estimate", monthlyCents: 0 });
  });
});
