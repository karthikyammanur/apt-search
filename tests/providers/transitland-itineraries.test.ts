// Transitland's planner returns a walk-only itinerary beside the transit one. These tests use two real
// responses (trimmed to the fields the client reads) to check which itinerary becomes the commute,
// that vehicle labels become WALK or TRANSIT, and that agency and stop details are kept.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routeToLegs, type StopRow } from "@/lib/intake/enrich";
import { createTransitland } from "@/lib/providers/transitland";
import type { Transport } from "@/lib/providers";
import { bayAreaPack } from "@/lib/regions";

const read = (name: string): { plan: { itineraries: Record<string, unknown>[] } } =>
  JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "providers", `${name}.json`), "utf8"));

const from = { lat: 37.4419, lng: -122.1608 };
const to = { lat: 37.4419, lng: -122.143 };
const arriveBy = "2026-12-01T08:30:00-08:00";

/** A transport that answers with a recorded body, checked against the schema the client passes. */
const serving = (body: unknown): Transport => async (_provider, request) => {
  const parsed = request.schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "bad_response" };
};
const route = (body: unknown) => createTransitland({ key: "test", transport: serving(body) }).route(from, to, arriveBy);

describe("which itinerary is the commute", () => {
  it("takes the 15 minute bus, not the 31 minute walk the planner lists first", async () => {
    const body = read("transitland-walk-first");
    expect(body.plan.itineraries.map((i) => i.duration)).toEqual([1808, 853]); // the walk really is first
    const result = await route(body);
    expect(result).toMatchObject({ ok: true, data: { minutes: 15 } });
  });

  it("does not depend on the order the planner lists them in", async () => {
    const body = read("transitland-walk-first");
    const reversed = { plan: { itineraries: [...body.plan.itineraries].reverse() } };
    expect(await route(reversed)).toEqual(await route(body));
  });

  it("takes a walk-only itinerary when it is the quickest way", async () => {
    const body = read("transitland-walk-first");
    const quickWalk = { plan: { itineraries: [{ duration: 300, legs: [{ mode: "WALK", duration: 300 }] }, ...body.plan.itineraries] } };
    const result = await route(quickWalk);
    expect(result).toMatchObject({ ok: true, data: { minutes: 5, steps: [{ mode: "WALK", minutes: 5 }] } });
  });

  it("is not found when the planner returns no itinerary", async () => {
    expect(await route({ plan: { itineraries: [] } })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("the steps of the chosen itinerary", () => {
  it("calls the bus TRANSIT, keeps the agency, and keeps where it boards and gets off", async () => {
    const result = await route(read("transitland-walk-first"));
    if (!result.ok) throw new Error("route failed");
    expect(result.data.steps.map((s) => s.mode)).toEqual(["WALK", "TRANSIT", "WALK"]);
    expect(result.data.steps[1]).toMatchObject({
      lineName: "21",
      agencyName: "VTA",
      departureStop: "Hamilton & Ramona",
      arrivalStop: "Middlefield & Embarcadero",
      departurePoint: { stopId: "61568", lat: 37.44464, lng: -122.16072 },
      arrivalPoint: { stopId: "61575" },
    });
  });

  it("leaves a walk's missing stop names as null, never an empty string", async () => {
    const result = await route(read("transitland-walk-first"));
    if (!result.ok) throw new Error("route failed");
    expect(result.data.steps[0]).toMatchObject({ mode: "WALK", departureStop: null, arrivalStop: "Hamilton & Ramona" });
    expect(result.data.steps[2]).toMatchObject({ mode: "WALK", arrivalStop: null });
  });

  it("calls every vehicle type TRANSIT and keeps walk and bicycle", async () => {
    const legs = ["BUS", "RAIL", "TRAM", "SUBWAY", "FERRY", "WALK", "BICYCLE"].map((mode) => ({ mode, duration: 60 }));
    const result = await route({ plan: { itineraries: [{ duration: 420, legs }] } });
    if (!result.ok) throw new Error("route failed");
    expect(result.data.steps.map((s) => s.mode)).toEqual(["TRANSIT", "TRANSIT", "TRANSIT", "TRANSIT", "TRANSIT", "WALK", "BICYCLE"]);
  });
});

describe("a trip that uses Caltrain, priced like Google's answer", () => {
  // Rows as the stop job writes them: one parent station per Caltrain station.
  const station = (stopId: string, name: string, lat: number, lng: number): StopRow => ({
    stopId,
    feed: "511",
    name,
    lat,
    lng,
    modes: ["rail"],
    medianRushHeadwayMin: 15,
  });
  const STOPS = [
    station("menlo_park", "Menlo Park", 37.4548, -122.18245),
    station("mtc:palo-alto-station", "Palo Alto Station", 37.44317, -122.16432),
    station("california_ave", "California Avenue", 37.42883, -122.14113),
  ];

  it("keeps the recorded route's shape: a walk, Caltrain, a walk, a VTA bus, a walk", async () => {
    const result = await route(read("transitland-caltrain"));
    if (!result.ok) throw new Error("route failed");
    expect(result.data.minutes).toBe(28);
    expect(result.data.steps.map((s) => [s.mode, s.agencyName ?? null])).toEqual([
      ["WALK", null],
      ["TRANSIT", "Caltrain"],
      ["WALK", null],
      ["TRANSIT", "VTA"],
      ["WALK", null],
    ]);
  });

  it("maps its platform points to the stop table's stations, which the platform names would not match", async () => {
    const result = await route(read("transitland-caltrain"));
    if (!result.ok) throw new Error("route failed");
    // Transitland's own names carry a direction ("Menlo Park Caltrain Station Southbound"): no fare zone.
    expect(result.data.steps[1]?.departureStop).toBe("Menlo Park Caltrain Station Southbound");
    expect(routeToLegs(result.data, []).legs.filter((l) => l.mode === "transit")[0]).toMatchObject({ agency: "caltrain", from: "Menlo Park Southbound" });
    // With the stop table, the points resolve to the stations.
    expect(routeToLegs(result.data, STOPS).legs.filter((l) => l.mode === "transit")).toEqual([
      { mode: "transit", agency: "caltrain", from: "Menlo Park", to: "Palo Alto Station" },
      { mode: "transit", agency: "vta", from: "Palo Alto Transit Center (Bay 5)", to: "Middlefield & Embarcadero" },
    ]);
  });

  it("prices a Caltrain 1 zone pass plus a VTA pass, instead of Unknown", async () => {
    const result = await route(read("transitland-caltrain"));
    if (!result.ok) throw new Error("route failed");
    expect(bayAreaPack.cheapestPass(routeToLegs(result.data, []))).toMatchObject({ status: "unknown" });
    expect(bayAreaPack.cheapestPass(routeToLegs(result.data, STOPS))).toMatchObject({
      status: "estimate",
      monthlyCents: 9600 + 9000,
      reason: "Caltrain monthly pass, 1 zone + VTA monthly pass",
    });
  });
});
