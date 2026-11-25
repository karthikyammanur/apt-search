// What the map draws: each Caltrain station once and only inside the search area, solid and hollow pins,
// and the camera. Plus the rule that the map's worker is served from public/ (the cause of the grey map).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundsOf,
  caltrainStations,
  distanceMeters,
  mapModel,
  SEARCH_AREA_RADIUS_METERS,
  searchAreaBounds,
  stationKey,
  type StopLike,
} from "@/lib/queries/map-model";

const OFFICE = { lat: 37.4419, lng: -122.143 };
const stop = (name: string, lat: number, lng: number, over: Partial<StopLike> = {}): StopLike => ({ feed: "511", name, lat, lng, modes: ["rail"], ...over });

const STOPS: StopLike[] = [
  // One station, three rows: parent and both platforms.
  stop("Menlo Park", 37.4548, -122.1825),
  stop("Menlo Park Caltrain Station Northbound", 37.4549, -122.1823),
  stop("Menlo Park Caltrain Station Southbound", 37.4547, -122.1824),
  stop("California Avenue", 37.4288, -122.1411),
  stop("California Avenue Caltrain Station Northbound", 37.4294, -122.1419),
  stop("California Avenue Caltrain Station Southbound", 37.4293, -122.142),
  // A station inside the zone table, with platforms only.
  stop("Palo Alto Caltrain Station Northbound", 37.4432, -122.1644),
  // Looks like Caltrain but is a shuttle stop; and a shuttle stop of a company.
  stop("Menlo Park Caltrain (Crosstown Shuttle Stop)", 37.4541, -122.1825),
  stop("1200 O'Brien (AM Stop)", 37.476, -122.1468),
  // A bus stop, and a rail station that is far away from the office.
  stop("Hamilton & Ramona", 37.4446, -122.1607, { modes: ["bus"] }),
  stop("San Francisco Caltrain Station Northbound", 37.7764, -122.3942),
];

describe("Caltrain stations on the map", () => {
  const stations = caltrainStations(STOPS, OFFICE);

  it("shows each station once, merging parent, northbound and southbound stops", () => {
    expect(stations.map((s) => s.name)).toEqual(["California Ave", "Menlo Park", "Palo Alto"]);
  });

  it("puts a merged station at the middle of its stops", () => {
    const menlo = stations.find((s) => s.name === "Menlo Park")!;
    expect(menlo.lat).toBeCloseTo((37.4548 + 37.4549 + 37.4547) / 3, 6);
  });

  it("leaves out bus stops, shuttle stops and stations outside the search area", () => {
    const names = stations.map((s) => s.name.toLowerCase());
    expect(names.some((n) => n.includes("hamilton") || n.includes("o'brien") || n.includes("shuttle") || n.includes("san francisco"))).toBe(false);
    expect(distanceMeters({ lat: 37.7764, lng: -122.3942 }, OFFICE)).toBeGreaterThan(SEARCH_AREA_RADIUS_METERS);
  });

  it("respects the radius it is given", () => {
    expect(caltrainStations(STOPS, OFFICE, 2500).map((s) => s.name)).toEqual(["California Ave", "Palo Alto"]);
  });

  it("shows no stations without an office to measure from", () => {
    expect(caltrainStations(STOPS, null)).toEqual([]);
  });

  it("takes the demo feed's rail stops as stations", () => {
    expect(caltrainStations([stop("Demo Station", 37.44, -122.14, { feed: "demo" }), stop("Demo Bus", 37.44, -122.14, { feed: "demo", modes: ["bus"] })], OFFICE).map((s) => s.name)).toEqual(["Demo"]);
  });

  it.each([
    ["Menlo Park Caltrain Station Southbound", "menlo park"],
    ["California Avenue Caltrain Station Northbound", "california ave"],
    ["Mountain View", "mountain view"],
    ["Palo Alto Caltrain Station", "palo alto"],
  ])("%s is %s", (name, key) => {
    expect(stationKey(name)).toBe(key);
  });
});

describe("pins and the camera", () => {
  const items = [
    { id: 7, lat: 37.44, lng: -122.14, approximateLocation: false },
    { id: 9, lat: 37.45, lng: -122.16, approximateLocation: true },
    { id: 11, lat: null, lng: null, approximateLocation: false },
  ];

  it("numbers pins in list order, links them, and marks the approximate one hollow", () => {
    const model = mapModel(items, OFFICE);
    expect(model.pins).toEqual([
      { lat: 37.44, lng: -122.14, label: "1", href: "/listing/7", approximate: false },
      { lat: 37.45, lng: -122.16, label: "2", href: "/listing/9", approximate: true },
    ]);
    expect(model.unknownLocation).toBe(1);
  });

  it("fits the office and the pins", () => {
    expect(mapModel(items, OFFICE).fit).toEqual([-122.16, 37.4419 > 37.44 ? 37.44 : 37.4419, -122.14 > -122.143 ? -122.14 : -122.143, 37.45]);
  });

  it("fits the pins alone when the office is unknown", () => {
    expect(mapModel(items, null).fit).toEqual([-122.16, 37.44, -122.14, 37.45]);
  });

  it("fits the search area when there are no pins", () => {
    const model = mapModel([{ id: 1, lat: null, lng: null, approximateLocation: false }], OFFICE);
    expect(model.pins).toEqual([]);
    const [west, south, east, north] = model.fit!;
    expect(west).toBeLessThan(OFFICE.lng);
    expect(east).toBeGreaterThan(OFFICE.lng);
    expect(distanceMeters({ lat: south, lng: OFFICE.lng }, OFFICE)).toBeCloseTo(SEARCH_AREA_RADIUS_METERS, -2);
    expect(distanceMeters({ lat: north, lng: OFFICE.lng }, OFFICE)).toBeCloseTo(SEARCH_AREA_RADIUS_METERS, -2);
    expect(model.fit).toEqual(searchAreaBounds(OFFICE));
  });

  it("has nothing to fit with no pins and no office", () => {
    expect(mapModel([], null).fit).toBeNull();
    expect(boundsOf([])).toBeNull();
  });
});

describe("the basemap worker", () => {
  it("is served from public/, identical to the installed MapLibre's, so a version change is noticed", () => {
    const installed = readFileSync(path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"));
    const served = readFileSync(path.join(process.cwd(), "public", "maplibre", "maplibre-gl-worker.mjs"));
    // If this fails after upgrading maplibre-gl: cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs public/maplibre/
    expect(served.equals(installed)).toBe(true);
  });

  it("is the URL the map component sets", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "components", "listing-map.tsx"), "utf8");
    expect(source).toContain('MAP_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs"');
    expect(source).toContain("setWorkerUrl(MAP_WORKER_URL)");
  });
});
