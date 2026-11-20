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
    nearby(center: Coordinates, radiusMeters = 1500) {
      if (!areaInput.safeParse({ center, radiusMeters }).success)
        return Promise.resolve(failure("bad_response"));
      const area = `(around:${radiusMeters},${center.lat},${center.lng})`;
      const data = `[out:json][timeout:15];(nwr[shop~"^(supermarket|grocery|convenience)$"]${area};nwr[leisure=fitness_centre]${area};nwr[amenity=cafe]${area};);out center tags;`;
      return (options.transport ?? cachedFetch)(
        "overpass",
        {
          url: "https://overpass-api.de/api/interpreter",
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
    },
  };
}
export const overpass = createOverpass();
