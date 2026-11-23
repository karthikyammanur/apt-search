// RentCast channel: a radius search for long-term rentals around the office. Structured API data
// only, so the model is skipped and every field comes from the record itself. RentCast records
// carry no public listing link, so the saved link is an identifier of the form rentcast:<id>.

import type { createRentcast } from "@/lib/providers";
import type { RawListing } from "../types";
import type { Collected } from "./types";

type RentcastClient = Pick<ReturnType<typeof createRentcast>, "listings">;
type RentcastItem = {
  id: string;
  formattedAddress: string;
  latitude?: number | null;
  longitude?: number | null;
  price?: number | null;
  propertyType?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  [key: string]: unknown;
};

export function rentcastToRaw(item: RentcastItem): RawListing {
  const studio = item.bedrooms === 0;
  const price = typeof item.price === "number" && item.price > 0 ? item.price : null;
  const city = typeof item.city === "string" && item.city ? item.city : null;
  const text = [
    item.formattedAddress,
    [item.propertyType, item.bedrooms !== null && item.bedrooms !== undefined ? `${item.bedrooms} bd` : null, item.bathrooms !== null && item.bathrooms !== undefined ? `${item.bathrooms} ba` : null]
      .filter(Boolean)
      .join(", "),
    price !== null ? `Rent: $${price} a month` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    channel: "rentcast",
    source: "rentcast",
    url: `rentcast:${item.id}`,
    title: item.formattedAddress,
    text,
    photoUrls: [],
    photoHashes: [],
    skipModel: true,
    prefill: {
      postType: "whole_place_offered",
      address: item.formattedAddress,
      lat: item.latitude ?? null,
      lng: item.longitude ?? null,
      facts: {
        type: studio ? "studio" : "apartment",
        ...(city ? { city } : {}),
        ...(price !== null ? { rentCents: Math.round(price * 100) } : {}),
      },
    },
    meta: { rentcastId: item.id },
  };
}

export async function collectRentcast(
  client: RentcastClient,
  office: { lat: number; lng: number } | null,
  radiusMiles = 5,
): Promise<Collected> {
  if (!office) return { items: [], error: "office address could not be geocoded" };
  const result = await client.listings(office, radiusMiles);
  if (!result.ok) {
    // A blank key is the normal "off" state, not a failure.
    return result.error === "disabled"
      ? { items: [], error: null, skipped: "RentCast is disabled (no key)" }
      : { items: [], error: result.error };
  }
  return { items: result.data.map((item) => rentcastToRaw(item as RentcastItem)), error: null };
}
