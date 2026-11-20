import { describe, expect, it } from "vitest";
import { nearestStops, serviceQuality } from "../../src/lib/transit";
import { activeServices, chooseDate, compute } from "../../scripts/gtfs/compute";
import { csvRecords } from "../../scripts/gtfs/csv";

describe("GTFS", () => {
  it("computes counts, median gaps, modes and calendar exception from fixture", async () => {
    const result = await compute(
      "tests/fixtures/gtfs",
      "fixture",
      new Date("2026-11-20T00:00:00Z"),
    );
    expect(result.date).toBe("2027-01-12");
    expect(result.missingTimes).toBe(0);
    expect(
      result.stops.map((s) => [s.name, s.weekdayRushDepartures, s.medianRushHeadwayMin, s.modes]),
    ).toEqual([
      ["Example, Station", 2, 20, ["rail"]],
      ["Example Shuttle", 3, 25, ["bus", "rail"]],
    ]);
  });
  it("applies removals and finds a covered future Tuesday in exception-only feeds", () => {
    expect(
      activeServices("20270112", [], [{ service_id: "X", date: "20270112", exception_type: "2" }])
        .size,
    ).toBe(0);
    expect(
      chooseDate(
        [],
        [{ service_id: "X", date: "20261124", exception_type: "1" }],
        new Date("2026-11-20"),
      ),
    ).toBe("20261124");
    expect(() => chooseDate([], [], new Date("2026-11-20"))).toThrow("coverage");
  });
  it("streams quoted newlines, BOM-independent cells and split escaped quotes", async () => {
    async function* chunks() {
      for (const s of ['a,"multi\n', 'line "', '"quoted"', '""\r\n']) yield s;
    }
    const records = [];
    for await (const row of csvRecords(chunks())) records.push(row);
    expect(records).toEqual([["a", 'multi\nline "quoted"']]);
  });
});

describe("pure transit helpers", () => {
  it("sorts by haversine distance and excludes stops outside the radius", () => {
    const stops = [
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
    ];
    const found = nearestStops(0, 0, 1200, stops);
    expect(found.map((s) => s.lng)).toEqual([0, 0.01]);
    expect(found[1]!.distanceMeters).toBeCloseTo(1111.95, 1);
    expect(nearestStops(0, 0, 0, stops)).toHaveLength(1);
    expect(() => nearestStops(91, 0, 100, stops)).toThrow();
    expect(nearestStops(0, 179.999, 300, [{ lat: 0, lng: -179.999 }])).toHaveLength(1);
  });
  it.each([
    [0, 1],
    [10, 1],
    [20, 0.5],
    [30, 0],
    [60, 0],
    [null, 0],
    [-1, 0],
  ])("headway %s yields %s", (gap, expected) => {
    expect(serviceQuality({ medianRushHeadwayMin: gap })).toBe(expected);
  });
});
