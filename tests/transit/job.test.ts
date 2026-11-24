import { mkdtemp, readFile, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../src/db/schema";
import { transitStops } from "../../src/db/schema";
import { runMigrations } from "../../src/db/run-migrations";
import { agencyServiceDate, compute } from "../../scripts/gtfs/compute";
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
    await runMigrations(db);
    await upsertStops(db, result.stops);
    await upsertStops(
      db,
      result.stops.map((s) => ({ ...s, name: "Updated" })),
    );
    const saved = await db.select().from(transitStops);
    expect(saved).toHaveLength(2);
    expect(saved.every((s) => s.name === "Updated")).toBe(true);
    expect(saved.find((s) => s.stopId === "B")?.medianRushHeadwayMin).toBe(25);
    expect(saved.every((s) => s.scheduleBasis === "target_date" && s.scheduleDate === "2027-01-12")).toBe(true);
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

it("counts interleaved unsorted untimed stops, including frequency offsets and pickup anchors", async () => {
  const dir = await directory();
  await cp("tests/fixtures/gtfs", dir, { recursive: true });
  await writeFile(path.join(dir, "trips.txt"), "route_id,service_id,trip_id\nR,W,T1\nR,W,T2\n");
  await writeFile(
    path.join(dir, "stop_times.txt"),
    "trip_id,stop_id,stop_sequence,arrival_time,departure_time,shape_dist_traveled,pickup_type\n" +
      "T1,A,3,07:10:00,07:15:00,4,1\nT2,A,1,08:00:00,,0,0\n" +
      "T1,B,2,,,1,0\nT1,A,1,06:50:00,06:50:00,0,1\n",
  );
  await writeFile(
    path.join(dir, "frequencies.txt"),
    "trip_id,start_time,end_time,headway_secs\nT1,06:50:00,09:00:00,1200\n",
  );
  const result = await compute(dir, "fixture");
  expect(result.missingTimes).toBe(0);
  expect(result.interpolatedTimes).toBe(1);
  expect(result.before.map((s) => s.weekdayRushDepartures)).toEqual([0, 0]);
  expect(result.stops.map((s) => [s.weekdayRushDepartures, s.medianRushHeadwayMin])).toEqual([
    [1, null],
    [6, 20],
  ]);
});

it("falls back per agency to the same weekday in its last covered week, and labels those stops", async () => {
  const dir = await directory();
  await cp("tests/fixtures/gtfs", dir, { recursive: true });
  // Agency RAIL runs through January; agency BUS's calendar ends Friday 2027-01-08, before the
  // Tuesday 2027-01-12 target, the way an unpublished January looks in the real feed.
  await writeFile(path.join(dir, "agency.txt"), "agency_id,agency_name\nRAIL,Example Rail\nBUS,Example Bus\n");
  await writeFile(path.join(dir, "routes.txt"), "route_id,route_type,agency_id\nR,2,RAIL\nS,3,BUS\n");
  await writeFile(
    path.join(dir, "calendar.txt"),
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      "W,1,1,1,1,1,0,0,20261101,20270131\nV,1,1,1,1,1,0,0,20261101,20270108\n",
  );
  await writeFile(path.join(dir, "calendar_dates.txt"), "service_id,date,exception_type\n");
  await writeFile(path.join(dir, "trips.txt"), "route_id,service_id,trip_id\nR,W,T1\nR,W,T2\nS,V,T3\n");
  const result = await compute(dir, "fixture");
  expect(result.date).toBe("2027-01-12");
  expect(result.agencies).toEqual([
    { agencyId: "BUS", name: "Example Bus", day: "20270105", coverageEnd: "20270108", basis: "current_schedule" },
    { agencyId: "RAIL", name: "Example Rail", day: "20270112", coverageEnd: "20270131", basis: "service_date" },
  ]);
  // Without the fallback, B's bus trip T3 is not counted at all.
  expect(result.stops.map((s) => [s.stopId, s.weekdayRushDepartures, s.scheduleBasis])).toEqual([
    ["A", 2, "service_date"],
    ["B", 3, "current_schedule"],
  ]);
  // The label and the day actually counted are written to transit_stops.
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  try {
    await runMigrations(db);
    await upsertStops(db, result.stops);
    const saved = await db.select().from(transitStops).orderBy(transitStops.stopId);
    expect(saved.map((s) => [s.stopId, s.scheduleBasis, s.scheduleDate])).toEqual([
      ["A", "target_date", "2027-01-12"],
      ["B", "current_schedule", "2027-01-05"],
    ]);
  } finally {
    client.close();
  }
});

it("does not fall back when the agency's calendar covers the date", async () => {
  const dir = await directory();
  await cp("tests/fixtures/gtfs", dir, { recursive: true });
  const result = await compute(dir, "fixture");
  expect(result.agencies.every((a) => a.basis === "service_date" && a.day === "20270112")).toBe(true);
  expect(result.stops.every((s) => s.scheduleBasis === "service_date")).toBe(true);
});

it("steps back past a holiday with no service in the agency's last week", () => {
  const calendars = [
    { service_id: "V", monday: "1", tuesday: "1", wednesday: "1", thursday: "1", friday: "1", saturday: "0", sunday: "0", start_date: "20261101", end_date: "20270108" },
  ] as const;
  const holiday = [{ service_id: "V", date: "20270105", exception_type: "2" }] as const;
  expect(agencyServiceDate("20270112", new Set(["V"]), [...calendars], [...holiday])).toEqual({
    day: "20261229",
    coverageEnd: "20270108",
    basis: "current_schedule",
  });
  expect(agencyServiceDate("20270112", new Set(["V"]), [], [])).toEqual({
    day: "20270112",
    coverageEnd: null,
    basis: "service_date",
  });
});
