// The map services the pipeline needs, behind one small interface so tests can stub them.
// The live version only calls the cached provider clients in src/lib/providers/ (rule 5).

import {
  geocode as geocodeWithFallback,
  getTransitCommute,
  getWalkBike,
  geoapify,
  google,
  googleMode,
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
  /** `provider` says who routed it, so a free provider's answer can be treated with more care. */
  transit(from: Coordinates, to: Coordinates, arriveBy: string): Promise<Result<Route & { provider?: string }>>;
  walkBike(from: Coordinates, to: Coordinates, mode: "WALK" | "BICYCLE"): Promise<Result<Route>>;
  places(center: Coordinates, radiusMeters: number): Promise<Result<Place[]>>;
};

type PlacesClients = { google: typeof google; overpass: typeof overpass; geoapify: typeof geoapify };

/** OpenStreetMap elements from Overpass, reduced to the three place kinds the app cares about. */
async function overpassPlaces(
  client: PlacesClients["overpass"],
  center: Coordinates,
  radiusMeters: number,
): Promise<Result<Place[]>> {
  const found = await client.nearby(center, radiusMeters);
  if (!found.ok) return found;
  const mapped: Place[] = [];
  for (const element of found.data.elements) {
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

/** Geoapify Places, reduced to the same three kinds. */
async function geoapifyPlaces(
  client: PlacesClients["geoapify"],
  center: Coordinates,
  radiusMeters: number,
): Promise<Result<Place[]>> {
  const found = await client.places(center, radiusMeters);
  if (!found.ok) return found;
  const mapped: Place[] = [];
  for (const place of found.data) {
    const type = place.categories.includes("commercial.supermarket")
      ? "grocery_store"
      : place.categories.some((c) => c === "sport.fitness" || c.startsWith("sport.fitness."))
        ? "gym"
        : place.categories.includes("catering.cafe")
          ? "cafe"
          : null;
    if (!type) continue;
    mapped.push({ id: place.id, name: place.name ?? type.replace("_", " "), lat: place.lat, lng: place.lng, types: [type], rating: null });
  }
  return { ok: true, data: mapped };
}

/**
 * Nearby places, trying each source in turn until one answers:
 *  - a laptop: Google, then Overpass (which already retries on a second server), then Geoapify Places;
 *  - any Vercel deployment: Overpass, then Geoapify Places. Google's Demo Key may not be used there.
 */
export function createPlaces(clients: PlacesClients, env: Record<string, string | undefined> = process.env) {
  return async (center: Coordinates, radiusMeters: number): Promise<Result<Place[]>> => {
    const viaGoogle = () => clients.google.nearby(center, radiusMeters);
    const viaOverpass = () => overpassPlaces(clients.overpass, center, radiusMeters);
    const viaGeoapify = () => geoapifyPlaces(clients.geoapify, center, radiusMeters);
    const order = googleMode(env) === "primary" ? [viaGoogle, viaOverpass, viaGeoapify] : [viaOverpass, viaGeoapify];
    let last: Result<Place[]> = { ok: false, error: "disabled" };
    for (const attempt of order) {
      last = await attempt();
      if (last.ok) return last;
    }
    return last;
  };
}

const places = createPlaces({ google, overpass, geoapify });

export const liveGeo: Geo = {
  geocode: (address) => geocodeWithFallback(address),
  transit: (from, to, arriveBy) => getTransitCommute(from, to, arriveBy),
  walkBike: (from, to, mode) => getWalkBike(from, to, mode),
  places,
};
