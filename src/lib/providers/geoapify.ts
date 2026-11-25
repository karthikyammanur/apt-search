import { z } from "zod";
import { cachedFetch, failure, mapped, query, TTL, type ClientOptions } from "./core";
import { areaInput, minutes, routeInput, seconds, type Coordinates, type Route } from "./types";

export const geoapifyGeocodeSchema = z.object({
  results: z.array(
    z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      formatted: z.string(),
    }),
  ),
});
export const geoapifyRouteSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        time: seconds,
        legs: z.array(z.object({ steps: z.array(z.object({ time: seconds })) })),
      }),
    }),
  ),
});
export const geoapifyPlacesSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        place_id: z.string(),
        name: z.string().optional(),
        categories: z.array(z.string()).default([]),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      }),
    }),
  ),
});
/** One nearby place, with Geoapify's own category names (such as "commercial.supermarket"). */
export type GeoapifyPlace = { id: string; name: string | null; lat: number; lng: number; categories: string[] };
/** Supermarkets, fitness centres and cafes: the three place kinds the app looks for. */
export const GEOAPIFY_PLACE_CATEGORIES = "commercial.supermarket,sport.fitness,catering.cafe";
/**
 * One request per kind. In a single mixed request the nearest 60 places are mostly cafes and shops, which
 * crowds the gyms out. "sport.fitness" is Geoapify's category for gyms and fitness centres.
 */
export const GEOAPIFY_KIND_CATEGORIES = {
  grocery_store: "commercial.supermarket",
  gym: "sport.fitness",
  cafe: "catering.cafe",
} as const;

export function createGeoapify(options: ClientOptions = {}) {
  const transport = options.transport ?? cachedFetch;
  const key = () => (options.key ?? process.env.GEOAPIFY_API_KEY ?? "").trim();
  return {
    geocode(address: string) {
      if (!key()) return Promise.resolve(failure("disabled"));
      if (!z.string().trim().min(1).max(500).safeParse(address).success)
        return Promise.resolve(failure("bad_response"));
      return mapped(
        transport(
          "geoapify",
          {
            url: query("https://api.geoapify.com/v1/geocode/search", {
              text: address,
              format: "json",
              limit: 1,
              apiKey: key(),
            }),
            schema: geoapifyGeocodeSchema,
          },
          TTL.geocode,
        ),
        (data) => {
          const first = data.results[0];
          return first && { lat: first.lat, lng: first.lon, address: first.formatted };
        },
      );
    },
    places(center: Coordinates, radiusMeters = 1500, categories: string = GEOAPIFY_PLACE_CATEGORIES) {
      if (!key()) return Promise.resolve(failure("disabled"));
      if (!areaInput.safeParse({ center, radiusMeters }).success) return Promise.resolve(failure("bad_response"));
      return mapped(
        transport(
          "geoapify",
          {
            url: query("https://api.geoapify.com/v2/places", {
              categories,
              filter: `circle:${center.lng},${center.lat},${radiusMeters}`,
              bias: `proximity:${center.lng},${center.lat}`,
              limit: 60,
              apiKey: key(),
            }),
            schema: geoapifyPlacesSchema,
          },
          TTL.pois,
        ),
        (data): GeoapifyPlace[] =>
          data.features.map(({ properties: p }) => ({
            id: p.place_id,
            name: p.name ?? null,
            lat: p.lat,
            lng: p.lon,
            categories: p.categories,
          })),
      );
    },
    route(from: Coordinates, to: Coordinates, mode: "WALK" | "BICYCLE") {
      if (!key()) return Promise.resolve(failure("disabled"));
      if (!routeInput.safeParse({ from, to, mode }).success || !["WALK", "BICYCLE"].includes(mode))
        return Promise.resolve(failure("bad_response"));
      return mapped(
        transport(
          "geoapify",
          {
            url: query("https://api.geoapify.com/v1/routing", {
              waypoints: `${from.lat},${from.lng}|${to.lat},${to.lng}`,
              mode: mode === "WALK" ? "walk" : "bicycle",
              apiKey: key(),
            }),
            schema: geoapifyRouteSchema,
          },
          TTL.route,
        ),
        (data): Route | undefined => {
          const route = data.features[0]?.properties;
          return (
            route && {
              minutes: minutes(route.time),
              steps: route.legs.flatMap((leg) =>
                leg.steps.map((step) => ({ mode, lineName: null, minutes: minutes(step.time) })),
              ),
            }
          );
        },
      );
    },
  };
}
export const geoapify = createGeoapify();
