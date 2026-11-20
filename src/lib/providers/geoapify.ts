import { z } from "zod";
import { cachedFetch, failure, mapped, query, TTL, type ClientOptions } from "./core";
import { minutes, routeInput, seconds, type Coordinates, type Route } from "./types";

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
