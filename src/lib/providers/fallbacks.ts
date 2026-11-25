import { google } from "./google";
import { transitland } from "./transitland";
import { geoapify } from "./geoapify";
import { failure, type ProviderError, type Result } from "./core";
import type { Coordinates } from "./types";

type Env = Record<string, string | undefined>;

/**
 * How Google's Maps Demo Key may be used. Its terms forbid production use, so on any Vercel deployment
 * (production or preview) Google is never called. The free providers are the only source there.
 *  - "primary": a laptop, or a Vercel dev pull (VERCEL_ENV=development). Google first, the free providers as backup.
 *  - "off":     every Vercel production or preview deployment, and any deployment whose VERCEL_ENV is missing.
 */
export type GoogleMode = "primary" | "off";

export function googleMode(env: Env = process.env): GoogleMode {
  return !env.VERCEL || env.VERCEL_ENV === "development" ? "primary" : "off";
}

type Attempt<T, N extends string> = { name: N; run: () => Promise<Result<T>> };

/** Try each attempt in order and return the first success, tagged with who answered. */
async function firstOk<T, N extends string>(attempts: Attempt<T, N>[]): Promise<Result<T & { provider: N }>> {
  let error: ProviderError = "disabled";
  for (const attempt of attempts) {
    const result = await attempt.run();
    if (result.ok) return { ok: true, data: { ...result.data, provider: attempt.name } };
    error = result.error;
  }
  return failure(error);
}

/** Put Google first, or leave it out. The free providers keep their order. */
export function orderByMode<G, O>(mode: GoogleMode, googleAttempt: G, others: O[]): (G | O)[] {
  return mode === "primary" ? [googleAttempt, ...others] : others;
}

export function createFallbacks(clients = { google, transitland, geoapify }, env: Env = process.env) {
  return {
    getTransitCommute: (from: Coordinates, to: Coordinates, arriveBy: string) =>
      firstOk(
        orderByMode(
          googleMode(env),
          { name: "google" as const, run: () => clients.google.route(from, to, "TRANSIT", arriveBy) },
          [{ name: "transitland" as const, run: () => clients.transitland.route(from, to, arriveBy) }],
        ),
      ),
    getWalkBike: (from: Coordinates, to: Coordinates, mode: "WALK" | "BICYCLE") =>
      firstOk(
        orderByMode(
          googleMode(env),
          { name: "google" as const, run: () => clients.google.route(from, to, mode) },
          [{ name: "geoapify" as const, run: () => clients.geoapify.route(from, to, mode) }],
        ),
      ),
    geocode: (address: string) =>
      firstOk(
        orderByMode(
          googleMode(env),
          { name: "google" as const, run: () => clients.google.geocode(address) },
          [{ name: "geoapify" as const, run: () => clients.geoapify.geocode(address) }],
        ),
      ),
  };
}
export const { getTransitCommute, getWalkBike, geocode } = createFallbacks();
