// The map services the pipeline needs, behind one small interface so tests can stub them.
// The live version only calls the cached provider clients in src/lib/providers/ (rule 5).

import {
  geocode as geocodeWithFallback,
  getTransitCommute,
  getWalkBike,
  google,
  overpass,
  type Coordinates,
  type Result,
  type Route,
} from "@/lib/providers";

export type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Google place types, or the OpenStreetMap equivalent: grocery_store, gym, cafe. */
  types: string[];
  rating: number | null;
};

export type Geo = {
  geocode(address: string): Promise<Result<{ lat: number; lng: number; address: string }>>;
  transit(from: Coordinates, to: Coordinates, arriveBy: string): Promise<Result<Route>>;
  walkBike(from: Coordinates, to: Coordinates, mode: "WALK" | "BICYCLE"): Promise<Result<Route>>;
  places(center: Coordinates, radiusMeters: number): Promise<Result<Place[]>>;
};

/** Google Places first, then OpenStreetMap through Overpass. */
async function places(center: Coordinates, radiusMeters: number): Promise<Result<Place[]>> {
  const first = await google.nearby(center, radiusMeters);
  if (first.ok) return first;
  const second = await overpass.nearby(center, radiusMeters);
  if (!second.ok) return second;
  const mapped: Place[] = [];
  for (const element of second.data.elements) {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (lat === undefined || lng === undefined) continue;
    const tags = element.tags ?? {};
    const type =
      tags.shop === "supermarket" || tags.shop === "grocery"
        ? "grocery_store"
        : tags.leisure === "fitness_centre"
          ? "gym"
          : tags.amenity === "cafe"
            ? "cafe"
            : null;
    if (!type) continue;
    mapped.push({
      id: `${element.type}/${element.id}`,
      name: tags.name ?? type.replace("_", " "),
      lat,
      lng,
      types: [type],
      rating: null,
    });
  }
  return { ok: true, data: mapped };
}

export const liveGeo: Geo = {
  geocode: (address) => geocodeWithFallback(address),
  transit: (from, to, arriveBy) => getTransitCommute(from, to, arriveBy),
  walkBike: (from, to, mode) => getWalkBike(from, to, mode),
  places,
};
