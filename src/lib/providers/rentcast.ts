import { z } from "zod";
import { cachedFetch, failure, query, TTL, type ClientOptions } from "./core";
import { coordinates, type Coordinates } from "./types";

export const rentcastSchema = z.array(
  z
    .object({
      id: z.string(),
      formattedAddress: z.string(),
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      price: z.number().nonnegative().nullable().optional(),
      status: z.string().optional(),
      propertyType: z.string().optional(),
      bedrooms: z.number().nullable().optional(),
      bathrooms: z.number().nullable().optional(),
    })
    .passthrough(),
);
export function createRentcast(options: ClientOptions = {}) {
  return {
    listings(center: Coordinates, radiusMiles = 5) {
      const key = (options.key ?? process.env.RENTCAST_API_KEY ?? "").trim();
      if (!key) return Promise.resolve(failure("disabled"));
      if (
        !z
          .object({ center: coordinates, radiusMiles: z.number().positive().max(100) })
          .safeParse({ center, radiusMiles }).success
      )
        return Promise.resolve(failure("bad_response"));
      return (options.transport ?? cachedFetch)(
        "rentcast",
        {
          url: query("https://api.rentcast.io/v1/listings/rental/long-term", {
            latitude: center.lat,
            longitude: center.lng,
            radius: radiusMiles,
            status: "Active",
            limit: 50,
          }),
          init: { headers: { "X-Api-Key": key } },
          schema: rentcastSchema,
        },
        TTL.pois,
      );
    },
  };
}
export const rentcast = createRentcast();
