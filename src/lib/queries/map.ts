import { asc } from "drizzle-orm";
import { transitStops } from "@/db/schema";
import { requireLogin } from "@/app/(views)/auth";
import { geocode } from "@/lib/providers";
import { getSettings } from "./settings";
import { dbOf, type QueryOptions } from "./shared";

export type MapPoints = {
  office: { lat: number; lng: number } | null;
  stations: { name: string; lat: number; lng: number }[];
};

/** Only authenticated server renders may request the private office point. */
export async function getMapPoints(options?: QueryOptions): Promise<MapPoints> {
  await requireLogin();
  const { settings } = await getSettings(options);
  const result = await geocode(settings.officeAddress);
  const rows = await dbOf(options).select().from(transitStops).orderBy(asc(transitStops.name));
  const stations = rows
    .filter(
      (stop) =>
        /caltrain/i.test(`${stop.feed} ${stop.name}`) ||
        (stop.feed === "demo" && stop.modes.includes("rail")),
    )
    .map(({ name, lat, lng }) => ({ name, lat, lng }));
  return { office: result.ok ? { lat: result.data.lat, lng: result.data.lng } : null, stations };
}
