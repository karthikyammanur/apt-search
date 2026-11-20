import { mkdtemp, readFile, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../src/db/schema";
import { transitStops } from "../../src/db/schema";
import { compute } from "../../scripts/gtfs/compute";
import { download, extract } from "../../scripts/gtfs/download";
import { upsertStops } from "../../scripts/gtfs/store";

const temporary: string[] = [];
async function directory() {
  const dir = await mkdtemp(path.join(tmpdir(), "gtfs-test-"));
  temporary.push(dir);
  return dir;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

it("extracts a ZIP and upserts computed results idempotently", async () => {
  const dir = await directory();
  const tables: Record<string, Uint8Array> = {};
  for (const name of ["stops", "routes", "trips", "stop_times", "calendar", "calendar_dates"]) {
    tables[`${name}.txt`] = await readFile(`tests/fixtures/gtfs/${name}.txt`);
  }
  tables["../escape.txt"] = strToU8("ignored");
  const zip = path.join(dir, "feed.zip");
  await writeFile(zip, zipSync(tables));
  const extracted = path.join(dir, "extracted");
  await extract(zip, extracted);
  const result = await compute(extracted, "fixture");
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  try {
    await db.run(`CREATE TABLE transit_stops (feed TEXT NOT NULL, stop_id TEXT NOT NULL, name TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL, modes TEXT NOT NULL, weekday_rush_departures INTEGER NOT NULL,
      median_rush_headway_min INTEGER, computed_at TEXT NOT NULL, PRIMARY KEY(feed, stop_id))`);
    await upsertStops(db, result.stops);
    await upsertStops(
      db,
      result.stops.map((s) => ({ ...s, name: "Updated" })),
    );
    const saved = await db.select().from(transitStops);
    expect(saved).toHaveLength(2);
    expect(saved.every((s) => s.name === "Updated")).toBe(true);
    expect(saved.find((s) => s.stopId === "B")?.medianRushHeadwayMin).toBe(25);
  } finally {
    client.close();
  }
});

it("uses a fresh download cache without network or credentials", async () => {
  const dir = await directory();
  await writeFile(path.join(dir, "511.zip"), "cached");
  const network = vi.fn(() => {
    throw new Error("No network in tests");
  });
  vi.stubGlobal("fetch", network);
  expect(await download("511", dir)).toBe(path.join(dir, "511.zip"));
  expect(network).not.toHaveBeenCalled();
});

it("honors rush boundaries, pickup restrictions, overnight times and unknown gaps", async () => {
  const dir = await directory();
  await cp("tests/fixtures/gtfs", dir, { recursive: true });
  await writeFile(
    path.join(dir, "stop_times.txt"),
    `trip_id,stop_id,stop_sequence,departure_time,pickup_type
T1,A,1,06:59:59,0
T1,A,2,07:00:00,0
T1,A,3,08:59:59,0
T1,A,4,09:00:00,0
T1,A,5,07:30:00,1
T2,B,1,25:00:00,0
T3,B,1,,0
`,
  );
  const result = await compute(dir, "fixture");
  expect(result.missingTimes).toBe(1);
  expect(result.stops.map((s) => [s.weekdayRushDepartures, s.medianRushHeadwayMin])).toEqual([
    [2, 120],
    [0, null],
  ]);
});

it("expands frequency templates using each stop's offset", async () => {
  const dir = await directory();
  await cp("tests/fixtures/gtfs", dir, { recursive: true });
  await writeFile(path.join(dir, "trips.txt"), "route_id,service_id,trip_id\nR,W,T1\n");
  await writeFile(
    path.join(dir, "stop_times.txt"),
    "trip_id,stop_id,stop_sequence,departure_time\nT1,A,1,06:00:00\nT1,B,2,06:10:00\n",
  );
  await writeFile(
    path.join(dir, "frequencies.txt"),
    "trip_id,start_time,end_time,headway_secs\nT1,06:00:00,09:00:00,1200\n",
  );
  const result = await compute(dir, "fixture");
  expect(result.stops.map((s) => [s.weekdayRushDepartures, s.medianRushHeadwayMin])).toEqual([
    [6, 20],
    [6, 20],
  ]);
});
