// The map services the pipeline needs, behind one small interface so tests can stub them.
// The live version only calls the cached provider clients in src/lib/providers/ (rule 5).

import {
  geocode as geocodeWithFallback,
  getTransitCommute,
  getWalkBike,
  GEOAPIFY_KIND_CATEGORIES,
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

export type PlaceKind = "grocery_store" | "gym" | "cafe";
export const PLACE_KINDS: readonly PlaceKind[] = ["grocery_store", "gym", "cafe"];

/**
 * The places found, plus the kinds this source could not vouch for. A free source (OpenStreetMap, Geoapify)
 * finding no gym does not mean there is none, so that kind is "not checked" and must not become 0 or "none".
 */
export type PlacesFound = Place[] & { notChecked?: PlaceKind[] };

export type Geo = {
  geocode(address: string): Promise<Result<{ lat: number; lng: number; address: string }>>;
  /** `provider` says who routed it, so a free provider's answer can be treated with more care. */
  transit(from: Coordinates, to: Coordinates, arriveBy: string): Promise<Result<Route & { provider?: string }>>;
  walkBike(from: Coordinates, to: Coordinates, mode: "WALK" | "BICYCLE"): Promise<Result<Route>>;
  places(center: Coordinates, radiusMeters: number): Promise<Result<PlacesFound>>;
};

type PlacesClients = { google: typeof google; overpass: typeof overpass; geoapify: typeof geoapify };

/** Attach the kinds that came back empty from a source that cannot prove an absence. */
function withNotChecked(places: Place[], kinds: readonly PlaceKind[]): PlacesFound {
  const found: PlacesFound = [...places];
  const missing = kinds.filter((kind) => !places.some((p) => p.types.includes(kind)));
  if (missing.length > 0) found.notChecked = missing;
  return found;
}

/**
 * Grocery means a supermarket or grocery store. Google also files corner shops and gas station shops under
 * grocery_store, which is why its nearest "grocery" differed from the free chain's. Those lose the kind.
 */
export function isGroceryStore(types: readonly string[]): boolean {
  if (types.includes("convenience_store") || types.includes("gas_station")) return false;
  return types.includes("supermarket") || types.includes("grocery_store");
}

/** Google's results with a convenience store or gas station no longer counted as a grocery store. */
export function googlePlaceKinds(places: readonly Place[]): Place[] {
  const kept: Place[] = [];
  for (const place of places) {
    const grocery = place.types.includes("grocery_store") || place.types.includes("supermarket");
    if (!grocery || isGroceryStore(place.types)) {
      kept.push(place);
      continue;
    }
    const types = place.types.filter((t) => t !== "grocery_store" && t !== "supermarket");
    if (types.some((t) => t === "gym" || t === "cafe")) kept.push({ ...place, types });
  }
  return kept;
}

/** The app's place kind for one OpenStreetMap element, or null for anything else. */
export function overpassKind(tags: Record<string, string>): PlaceKind | null {
  if (tags.shop === "supermarket" || tags.shop === "grocery") return "grocery_store";
  if (tags.leisure === "fitness_centre" || tags.amenity === "gym") return "gym";
  if (tags.leisure === "sports_centre" && (tags.sport ?? "").split(";").includes("fitness")) return "gym";
  if (tags.amenity === "cafe") return "cafe";
  return null;
}

/** OpenStreetMap elements from Overpass, reduced to the three place kinds the app cares about. */
async function overpassPlaces(
  client: PlacesClients["overpass"],
  center: Coordinates,
  radiusMeters: number,
): Promise<Result<PlacesFound>> {
  const found = await client.nearby(center, radiusMeters);
  if (!found.ok) return found;
  const mapped: Place[] = [];
  for (const element of found.data.elements) {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (lat === undefined || lng === undefined) continue;
    const tags = element.tags ?? {};
    const type = overpassKind(tags);
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
  return { ok: true, data: withNotChecked(mapped, PLACE_KINDS) };
}

/** The app's place kind for one Geoapify category list, or null for anything else. */
export function geoapifyKind(categories: readonly string[]): PlaceKind | null {
  if (categories.includes("commercial.supermarket")) return "grocery_store";
  if (categories.some((c) => c === "sport.fitness" || c.startsWith("sport.fitness."))) return "gym";
  if (categories.includes("catering.cafe")) return "cafe";
  return null;
}

/** Geoapify Places, one request per kind, reduced to the same three kinds. */
async function geoapifyPlaces(
  client: PlacesClients["geoapify"],
  center: Coordinates,
  radiusMeters: number,
): Promise<Result<PlacesFound>> {
  const mapped: Place[] = [];
  const seen = new Set<string>();
  let firstError: Result<never> | null = null;
  let answered = 0;
  for (const kind of PLACE_KINDS) {
    const found = await client.places(center, radiusMeters, GEOAPIFY_KIND_CATEGORIES[kind]);
    if (!found.ok) {
      firstError ??= found;
      continue;
    }
    answered += 1;
    for (const place of found.data) {
      const type = geoapifyKind(place.categories);
      if (!type || seen.has(place.id)) continue;
      seen.add(place.id);
      mapped.push({ id: place.id, name: place.name ?? type.replace("_", " "), lat: place.lat, lng: place.lng, types: [type], rating: null });
    }
  }
  // Every request failed: report the failure. Some failed: those kinds stay "not checked".
  if (answered === 0 && firstError) return firstError;
  return { ok: true, data: withNotChecked(mapped, PLACE_KINDS) };
}

/**
 * Nearby places, trying each source in turn until one answers:
 *  - a laptop: Google, then Overpass (which already retries on a second server), then Geoapify Places;
 *  - any Vercel deployment: Overpass, then Geoapify Places. Google's Demo Key may not be used there.
 */
export function createPlaces(clients: PlacesClients, env: Record<string, string | undefined> = process.env) {
  return async (center: Coordinates, radiusMeters: number): Promise<Result<PlacesFound>> => {
    const viaGoogle = async (): Promise<Result<PlacesFound>> => {
      const found = await clients.google.nearby(center, radiusMeters);
      return found.ok ? { ok: true, data: googlePlaceKinds(found.data) } : found;
    };
    const viaOverpass = () => overpassPlaces(clients.overpass, center, radiusMeters);
    const viaGeoapify = () => geoapifyPlaces(clients.geoapify, center, radiusMeters);
    const order = googleMode(env) === "primary" ? [viaGoogle, viaOverpass, viaGeoapify] : [viaOverpass, viaGeoapify];
    let last: Result<PlacesFound> = { ok: false, error: "disabled" };
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
