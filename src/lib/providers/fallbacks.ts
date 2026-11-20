import { google } from "./google";
import { transitland } from "./transitland";
import { geoapify } from "./geoapify";
import type { Result } from "./core";
import type { Coordinates } from "./types";

async function fallback<T, P extends string, Q extends string>(
  primary: () => Promise<Result<T>>,
  primaryName: P,
  backup: () => Promise<Result<T>>,
  backupName: Q,
): Promise<Result<T & { provider: P | Q }>> {
  const first = await primary();
  if (first.ok) return { ok: true, data: { ...first.data, provider: primaryName } };
  const second = await backup();
  return second.ok ? { ok: true, data: { ...second.data, provider: backupName } } : second;
}
export function createFallbacks(clients = { google, transitland, geoapify }) {
  return {
    getTransitCommute: (from: Coordinates, to: Coordinates, arriveBy: string) =>
      fallback(
        () => clients.google.route(from, to, "TRANSIT", arriveBy),
        "google",
        () => clients.transitland.route(from, to, arriveBy),
        "transitland",
      ),
    getWalkBike: (from: Coordinates, to: Coordinates, mode: "WALK" | "BICYCLE") =>
      fallback(
        () => clients.google.route(from, to, mode),
        "google",
        () => clients.geoapify.route(from, to, mode),
        "geoapify",
      ),
    geocode: (address: string) =>
      fallback(
        () => clients.google.geocode(address),
        "google",
        () => clients.geoapify.geocode(address),
        "geoapify",
      ),
  };
}
export const { getTransitCommute, getWalkBike, geocode } = createFallbacks();
