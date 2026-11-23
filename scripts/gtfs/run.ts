import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createDb } from "../../src/db";
import { compute, type StopResult } from "./compute";
import { download, extract, FEEDS } from "./download";
import { upsertStops } from "./store";
import { SUMMARY_STATIONS } from "./summary";

async function main() {
  await mkdir("data/gtfs", { recursive: true });
  const db = createDb();
  const stations = SUMMARY_STATIONS;
  const found = new Set<string>();
  const changedBusStops: { before: StopResult; after: StopResult }[] = [];
  for (const feed of FEEDS) {
    const zip = await download(feed);
    const directory = await mkdtemp(path.join("data/gtfs", `${feed}-`));
    try {
      await extract(zip, directory);
      const result = await compute(directory, feed);
      console.log(
        `${feed}: service date ${result.date}; weekday 07:00 inclusive to 09:00 exclusive; ${result.stops.length} stops`,
      );
      if (result.missingTimes)
        console.log(
          `${feed}: WARNING ${result.missingTimes} active stop times remain unbounded or invalid and were omitted`,
        );
      console.log(`${feed}: interpolated ${result.interpolatedTimes} active untimed stop times`);
      const before = new Map(result.before.map((stop) => [stop.stopId, stop]));
      for (const after of result.stops) {
        const old = before.get(after.stopId)!;
        if (
          after.modes.includes("bus") &&
          after.weekdayRushDepartures !== old.weekdayRushDepartures
        )
          changedBusStops.push({ before: old, after });
      }
      await upsertStops(db, result.stops);
      for (const station of stations) {
        for (const stop of result.stops.filter((s) => station.pattern.test(s.name))) {
          if (station.requiredMode && !stop.modes.includes(station.requiredMode)) continue;
          found.add(station.label);
          console.log(
            `${station.label}: ${feed}/${stop.stopId} ${stop.name}: before ${before.get(stop.stopId)!.weekdayRushDepartures}, after ${stop.weekdayRushDepartures} rush-hour departures; median gap ${stop.medianRushHeadwayMin === null ? "Unknown" : `${stop.medianRushHeadwayMin} min`}; modes ${stop.modes.join(", ") || "Unknown"}`,
          );
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  changedBusStops.sort(
    (a, b) =>
      b.after.weekdayRushDepartures -
        b.before.weekdayRushDepartures -
        (a.after.weekdayRushDepartures - a.before.weekdayRushDepartures) ||
      `${a.after.feed}/${a.after.stopId}`.localeCompare(`${b.after.feed}/${b.after.stopId}`),
  );
  for (const { before, after } of changedBusStops.slice(0, 3))
    console.log(
      `Largest bus count change: ${after.feed}/${after.stopId} ${after.name}: before ${before.weekdayRushDepartures}, after ${after.weekdayRushDepartures} rush-hour departures`,
    );
  for (const station of stations)
    if (!found.has(station.label)) throw new Error(`${station.label}: not found in current feeds`);
}

main().catch((error: unknown) => {
  // Network errors are sanitized by download.ts before reaching this boundary.
  console.error(error instanceof Error ? error.message : "GTFS job failed");
  process.exitCode = 1;
});
