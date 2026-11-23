import { z } from "zod";
import { cachedFetch, failure, query, TTL, type ClientOptions } from "./core";
import { coordinates, type Coordinates } from "./types";

export function rentcastAccessReason(body: unknown, status: number): string | undefined {
  if (![401, 402, 403].includes(status)) return undefined;
  const parsed = z.object({ message: z.string().optional() }).safeParse(body);
  const message = parsed.success ? (parsed.data.message ?? "") : "";
  if (/payment|billing|credit.card/i.test(message))
    return "API access requires billing setup or a payment method; check the RentCast dashboard";
  if (/activat|subscription|subscrib|plan/i.test(message))
    return "API key or subscription is not active; check activation and plan in the RentCast dashboard";
  return status === 401
    ? "API authentication rejected; check key validity and activation in the RentCast dashboard"
    : "API access forbidden; check key restrictions, subscription and billing in the RentCast dashboard";
}

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
          // RentCast documents 401 as invalid credentials and 403 as key restrictions or billing.
          classify: (body, status) => (rentcastAccessReason(body, status) ? "disabled" : undefined),
        },
        TTL.pois,
      );
    },
  };
}
export const rentcast = createRentcast();
