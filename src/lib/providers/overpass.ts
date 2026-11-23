import { z } from "zod";
import { cachedFetch, failure, TTL, type ClientOptions } from "./core";
import { areaInput, type Coordinates } from "./types";

export const overpassSchema = z
  .object({
    version: z.number(),
    elements: z.array(
      z.object({
        type: z.enum(["node", "way", "relation"]),
        id: z.number().int(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        center: z.object({ lat: z.number(), lon: z.number() }).optional(),
        tags: z.record(z.string(), z.string()).optional(),
      }),
    ),
    remark: z.string().optional(),
  })
  .refine((v) => !v.remark);
export function createOverpass(options: Pick<ClientOptions, "transport"> = {}) {
  return {
    async nearby(center: Coordinates, radiusMeters = 1500) {
      if (!areaInput.safeParse({ center, radiusMeters }).success)
        return Promise.resolve(failure("bad_response"));
      const area = `(around:${radiusMeters},${center.lat},${center.lng})`;
      const data = `[out:json][timeout:15];(nwr[shop~"^(supermarket|grocery|convenience)$"]${area};nwr[leisure=fitness_centre]${area};nwr[amenity=cafe]${area};);out center tags;`;
      const transport = options.transport ?? cachedFetch;
      let result;
      for (const url of [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
      ]) {
        result = await transport(
          "overpass",
          {
            url,
            // Allow queue and transfer time beyond the query's 15-second server budget.
            timeoutMs: 45_000,
            // Reserve the second request in the provider budget for the other endpoint.
            attempts: 1,
            init: {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "ApartmentFinder/0.1 (single-user housing POI prototype)",
              },
              body: new URLSearchParams({ data }).toString(),
            },
            schema: overpassSchema,
          },
          TTL.pois,
        );
        if (result.ok || result.error === "disabled" || result.error === "quota_paused")
          return result;
      }
      return result!;
    },
  };
}
export const overpass = createOverpass();
