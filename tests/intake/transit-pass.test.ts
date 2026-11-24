// Transit pass pricing from route details: the Google client reads agency and stop names from a
// recorded Routes response, routeToLegs keeps them, and the Bay Area pack prices the Caltrain pass
// by the zones the ride spans. No network: the recorded fixture is served by a stub transport.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routeToLegs, stationName } from "@/lib/intake/enrich";
import type { Transport } from "@/lib/providers/core";
import { createGoogle } from "@/lib/providers/google";
import type { Route } from "@/lib/providers/types";
import { bayAreaPack } from "@/lib/regions";

const FIXTURE = path.join(process.cwd(), "tests", "fixtures", "providers", "google-transit-details.json");
const recorded: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));

const fixtureTransport: Transport = async (_provider, request) => {
  const parsed = request.schema.safeParse(recorded);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "bad_response" };
};

describe("Caltrain pass from route details", () => {
  it("reads agency and stop names from the recorded Routes response", async () => {
    const google = createGoogle({ transport: fixtureTransport, key: "test" });
    const result = await google.route({ lat: 37.4854, lng: -122.2317 }, { lat: 37.4291, lng: -122.1419 }, "TRANSIT", "2027-01-11T16:30:00Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transit = result.data.steps.filter((s) => s.mode === "TRANSIT");
    expect(transit).toEqual([
      {
        mode: "TRANSIT",
        lineName: "Local Weekday",
        minutes: 10,
        agencyName: "Caltrain",
        departureStop: "Redwood City",
        arrivalStop: "California Avenue Train Station",
      },
    ]);
    // Walk steps get no transit fields.
    expect(result.data.steps.find((s) => s.mode === "WALK")).toEqual({ mode: "WALK", lineName: null, minutes: 1 });

    const legs = routeToLegs(result.data);
    expect(legs.legs.find((l) => l.mode === "transit")).toEqual({ mode: "transit", agency: "caltrain", from: "Redwood City", to: "California Avenue" });
    // Redwood City is zone 2 and California Ave zone 3: a 2-zone pass.
    expect(bayAreaPack.cheapestPass(legs)).toMatchObject({
      status: "estimate",
      monthlyCents: 15000,
      passes: [{ agency: "caltrain", product: "Caltrain monthly pass, 2 zones", cents: 15000 }],
    });
  });

  it("prices a California Ave to Palo Alto ride as a 1-zone pass", () => {
    const route: Route = {
      minutes: 15,
      steps: [
        { mode: "WALK", lineName: null, minutes: 3 },
        {
          mode: "TRANSIT",
          lineName: "Local Weekday",
          minutes: 5,
          agencyName: "Caltrain",
          departureStop: "California Avenue Train Station",
          arrivalStop: "Palo Alto Caltrain Station",
        },
        { mode: "WALK", lineName: null, minutes: 7 },
      ],
    };
    const legs = routeToLegs(route);
    expect(legs.legs[1]).toEqual({ mode: "transit", agency: "caltrain", from: "California Avenue", to: "Palo Alto" });
    expect(bayAreaPack.cheapestPass(legs)).toMatchObject({
      status: "estimate",
      monthlyCents: 9600,
      passes: [{ product: "Caltrain monthly pass, 1 zone", cents: 9600 }],
    });
  });

  it("keeps the zone Unknown when the provider names no stops", () => {
    const legs = routeToLegs({ minutes: 10, steps: [{ mode: "TRANSIT", lineName: "Caltrain Local", minutes: 10 }] });
    expect(legs.legs).toEqual([{ mode: "transit", agency: "caltrain", from: null, to: null }]);
    expect(bayAreaPack.cheapestPass(legs)).toMatchObject({ status: "unknown" });
  });

  it.each([
    ["California Avenue Train Station", "California Avenue"],
    ["Palo Alto Caltrain Station", "Palo Alto"],
    ["Redwood City", "Redwood City"],
    ["  ", null],
    [null, null],
  ])("station name %s becomes %s", (name, expected) => {
    expect(stationName(name)).toBe(expected);
  });
});
