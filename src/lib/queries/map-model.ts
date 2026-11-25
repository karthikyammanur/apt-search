// What the map shows, worked out without the browser: which Caltrain stations are drawn (each station
// once, only inside the search area), which pins are solid or hollow, and where to point the camera.
// Pure functions, so the rules are tested without a map.

import { caltrainZone } from "@/lib/regions";

/** The search area is a circle around the office. Stations and the empty-map view use it. */
export const SEARCH_AREA_RADIUS_METERS = 10_000;

export type LatLng = { lat: number; lng: number };
export type Station = LatLng & { name: string };

/** The columns of a stop that decide whether it is a Caltrain station. */
export type StopLike = { feed: string; name: string; lat: number; lng: number; modes: readonly string[] };

const EARTH_RADIUS_METERS = 6_371_000;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** "Menlo Park Caltrain Station Southbound" and "Menlo Park" are the same station: "menlo park". */
export function stationKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:caltrain|train|station|northbound|southbound)\b/g, " ")
    .replace(/\bavenue\b/g, "ave")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The name shown for a station: the key, in capitals ("california ave" becomes "California Ave"). */
function stationLabel(key: string): string {
  return key.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * A stop is a Caltrain station when its own name says so ("... Caltrain Station Northbound"), or it is
 * a rail stop of a station the fare table lists. Shuttle stops that borrow a station's name are not,
 * and neither is any bus stop.
 */
function isCaltrainStation(stop: StopLike): boolean {
  if (/shuttle/i.test(stop.name)) return false;
  if (stop.feed === "demo") return stop.modes.includes("rail");
  if (!stop.modes.includes("rail")) return false;
  return /caltrain station|train station/i.test(stop.name) || caltrainZone(stop.name) !== null;
}

/**
 * Each Caltrain station once, inside the search area. Northbound, southbound and parent stops of one
 * station merge into one point, at the middle of them. Nothing is returned without an office to measure from.
 */
export function caltrainStations(
  stops: readonly StopLike[],
  office: LatLng | null,
  radiusMeters: number = SEARCH_AREA_RADIUS_METERS,
): Station[] {
  if (!office) return [];
  const groups = new Map<string, StopLike[]>();
  for (const stop of stops) {
    if (!isCaltrainStation(stop)) continue;
    const key = stationKey(stop.name);
    if (key) groups.set(key, [...(groups.get(key) ?? []), stop]);
  }
  const stations: Station[] = [];
  for (const [key, members] of groups) {
    const lat = members.reduce((sum, s) => sum + s.lat, 0) / members.length;
    const lng = members.reduce((sum, s) => sum + s.lng, 0) / members.length;
    if (distanceMeters({ lat, lng }, office) <= radiusMeters) stations.push({ name: stationLabel(key), lat, lng });
  }
  return stations.sort((a, b) => a.name.localeCompare(b.name));
}

export type MapItem = { id: number; lat: number | null; lng: number | null; approximateLocation: boolean };
export type Pin = LatLng & { label: string; href: string; approximate: boolean };
/** [west, south, east, north]. */
export type Bounds = [number, number, number, number];

/** The box around a circle of the search area. */
export function searchAreaBounds(center: LatLng, radiusMeters: number = SEARCH_AREA_RADIUS_METERS): Bounds {
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  return [center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat];
}

export function boundsOf(points: readonly LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  return [
    Math.min(...points.map((p) => p.lng)),
    Math.min(...points.map((p) => p.lat)),
    Math.max(...points.map((p) => p.lng)),
    Math.max(...points.map((p) => p.lat)),
  ];
}

export type MapModel = {
  pins: Pin[];
  office: LatLng | null;
  /** What the camera fits: the office and the listing pins, or the search area when there are no pins. */
  fit: Bounds | null;
  /** Listings with no point at all. */
  unknownLocation: number;
};

export function mapModel(items: readonly MapItem[], office: LatLng | null): MapModel {
  const pins: Pin[] = [];
  items.forEach((item, index) => {
    if (item.lat === null || item.lng === null) return;
    pins.push({ lat: item.lat, lng: item.lng, label: String(index + 1), href: `/listing/${item.id}`, approximate: item.approximateLocation });
  });
  const fit = pins.length > 0 ? boundsOf([...pins, ...(office ? [office] : [])]) : office ? searchAreaBounds(office) : null;
  return { pins, office, fit, unknownLocation: items.length - pins.length };
}
