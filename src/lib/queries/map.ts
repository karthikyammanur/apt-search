import { transitStops } from "@/db/schema";
import { requireLogin } from "@/app/(views)/auth";
import { geocode } from "@/lib/providers";
import { getSettings } from "./settings";
import { dbOf, type QueryOptions } from "./shared";
import { caltrainStations, type LatLng, type Station } from "./map-model";

export type MapPoints = {
  office: LatLng | null;
  /** Each Caltrain station once, inside the search area around the office. */
  stations: Station[];
};

/** Only authenticated server renders may request the private office point. */
export async function getMapPoints(options?: QueryOptions): Promise<MapPoints> {
  await requireLogin();
  const { settings } = await getSettings(options);
  const result = await geocode(settings.officeAddress);
  const office = result.ok ? { lat: result.data.lat, lng: result.data.lng } : null;
  const rows = await dbOf(options).select().from(transitStops);
  return { office, stations: caltrainStations(rows, office) };
}
