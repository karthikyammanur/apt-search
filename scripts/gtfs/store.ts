import { sql } from "drizzle-orm";
import { transitStops, type Db } from "../../src/db";
import type { ScheduleBasis, StopResult } from "./compute";

/** The job says "service_date"; the column says "target_date" (see SCHEDULE_BASES in the schema). */
export function storedBasis(basis: ScheduleBasis): "target_date" | "current_schedule" {
  return basis === "current_schedule" ? "current_schedule" : "target_date";
}

export function stopRow(stop: StopResult): typeof transitStops.$inferInsert {
  return {
    feed: stop.feed,
    stopId: stop.stopId,
    name: stop.name,
    lat: stop.lat,
    lng: stop.lng,
    modes: stop.modes,
    weekdayRushDepartures: stop.weekdayRushDepartures,
    medianRushHeadwayMin: stop.medianRushHeadwayMin,
    scheduleBasis: storedBasis(stop.scheduleBasis),
    scheduleDate: stop.scheduleDate,
    computedAt: stop.computedAt,
  };
}

/** Only transit_stops is written, in a transaction so a feed is never half updated. */
export async function upsertStops(db: Db, stops: StopResult[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < stops.length; i += 75) {
      await tx
        .insert(transitStops)
        .values(stops.slice(i, i + 75).map(stopRow))
        .onConflictDoUpdate({
          target: [transitStops.feed, transitStops.stopId],
          set: {
            name: sql`excluded.name`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            modes: sql`excluded.modes`,
            weekdayRushDepartures: sql`excluded.weekday_rush_departures`,
            medianRushHeadwayMin: sql`excluded.median_rush_headway_min`,
            scheduleBasis: sql`excluded.schedule_basis`,
            scheduleDate: sql`excluded.schedule_date`,
            computedAt: sql`excluded.computed_at`,
          },
        });
    }
  });
}
