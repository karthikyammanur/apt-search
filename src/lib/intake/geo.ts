// The map services the pipeline needs, behind one small interface so tests can stub them.
// The live version only calls the cached provider clients in src/lib/providers/ (rule 5).

import {
  geocode as geocodeWithFallback,
  getTransitCommute,
  getWalkBike,
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
  transit(from: Coordinates, to: Coordinates, arriveBy: string): Promise<Result<Route>>;
  walkBike(from: Coordinates, to: Coordinates, mode: "WALK" | "BICYCLE"): Promise<Result<Route>>;
  places(center: Coordinates, radiusMeters: number): Promise<Result<Place[]>>;
};

type PlacesClients = Pick<{ google: typeof google; overpass: typeof overpass }, "google" | "overpass">;

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

/**
 * Nearby places. Which source goes first follows googleMode: Google first on a laptop, Overpass first
 * on a Vercel preview, and Overpass only on Vercel production (the Demo Key may not be used there).
 */
export function createPlaces(clients: PlacesClients = { google, overpass }, env: Record<string, string | undefined> = process.env) {
  return async (center: Coordinates, radiusMeters: number): Promise<Result<Place[]>> => {
    const viaGoogle = () => clients.google.nearby(center, radiusMeters);
    const viaOverpass = () => overpassPlaces(clients.overpass, center, radiusMeters);
    const mode = googleMode(env);
    const order = mode === "primary" ? [viaGoogle, viaOverpass] : mode === "fallback" ? [viaOverpass, viaGoogle] : [viaOverpass];
    let last: Result<Place[]> = { ok: false, error: "disabled" };
    for (const attempt of order) {
      last = await attempt();
      if (last.ok) return last;
    }
    return last;
  };
}

const places = createPlaces();

export const liveGeo: Geo = {
  geocode: (address) => geocodeWithFallback(address),
  transit: (from, to, arriveBy) => getTransitCommute(from, to, arriveBy),
  walkBike: (from, to, mode) => getWalkBike(from, to, mode),
  places,
};
