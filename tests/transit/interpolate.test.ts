import { expect, it } from "vitest";
import { interpolate } from "../../scripts/gtfs/interpolate";

const stop = (sequence: number, time: number | null, distance: number | null = null) => ({
  sequence,
  arrival: time,
  departure: time,
  distance,
});

it("uses distance across consecutive gaps and arrival at the next timepoint", () => {
  expect(
    interpolate([
      stop(1, 25000, 0),
      stop(2, null, 1),
      stop(3, null, 3),
      { sequence: 4, arrival: 25400, departure: 26000, distance: 4 },
    ]),
  ).toEqual([25000, 25100, 25300, 26000]);
});

it("uses stop sequence when distance is absent, partial, flat or decreasing", () => {
  for (const distances of [
    [null, null, null],
    [0, null, 4],
    [0, 0, 0],
    [0, 5, 4],
  ]) {
    expect(
      interpolate([
        stop(10, 25000, distances[0]),
        stop(11, null, distances[1]),
        stop(14, 25400, distances[2]),
      ]),
    ).toEqual([25000, 25100, 25400]);
  }
});

it("preserves unbounded gaps, rejects backward time anchors and handles overnight times", () => {
  expect(
    interpolate([stop(1, null), stop(2, 90000), stop(3, null), stop(4, 90600), stop(5, null)]),
  ).toEqual([null, 90000, 90300, 90600, null]);
  expect(interpolate([stop(1, 400), stop(2, null), stop(3, 300)])).toEqual([400, null, 300]);
});
