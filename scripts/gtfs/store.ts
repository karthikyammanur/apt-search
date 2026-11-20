import { sql } from "drizzle-orm";
import { transitStops, type Db } from "../../src/db";
import type { StopResult } from "./compute";

/** Only transit_stops is written, in a transaction so a feed is never half updated. */
export async function upsertStops(db: Db, stops: StopResult[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < stops.length; i += 75) {
      await tx
        .insert(transitStops)
        .values(stops.slice(i, i + 75))
        .onConflictDoUpdate({
          target: [transitStops.feed, transitStops.stopId],
          set: {
            name: sql`excluded.name`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            modes: sql`excluded.modes`,
            weekdayRushDepartures: sql`excluded.weekday_rush_departures`,
            medianRushHeadwayMin: sql`excluded.median_rush_headway_min`,
            computedAt: sql`excluded.computed_at`,
          },
        });
    }
  });
}
