import { describe, expect, it } from "vitest";
import {
  arriveBy830,
  cityFromFormatted,
  enrichListing,
  estimateWalkMinutes,
  firstWeekdayOnOrAfter,
  isGeocodable,
  routeToLegs,
  type StopRow,
} from "@/lib/intake/enrich";
import { HOME, OFFICE, stubGeo } from "./helpers";

describe("arrival time", () => {
  it.each([
    ["2027-01-11", "2027-01-11"], // Monday
    ["2027-01-09", "2027-01-11"], // Saturday
    ["2027-01-10", "2027-01-11"], // Sunday
    ["2027-01-15", "2027-01-15"], // Friday
  ])("first weekday on or after %s is %s", (start, expected) => {
    expect(firstWeekdayOnOrAfter(start)).toBe(expected);
  });

  it.each([
    ["2027-01-11", "2027-01-11T08:30:00-08:00"], // standard time
    ["2027-07-12", "2027-07-12T08:30:00-07:00"], // daylight time
  ])("%s arrives at %s", (day, expected) => {
    expect(arriveBy830(day)).toBe(expected);
  });
});

describe("small helpers", () => {
  it("estimates a walk from a straight line with a detour factor", () => {
    expect(estimateWalkMinutes(400)).toBe(7); // 400 * 1.3 / 80 = 6.5
    expect(estimateWalkMinutes(1)).toBe(1);
  });

  it("only geocodes an address with a street number or an intersection", () => {
    expect(isGeocodable("340 Cedar Ln, Palo Alto")).toBe(true);
    expect(isGeocodable("University Ave & Emerson St")).toBe(true);
    expect(isGeocodable("Palo Alto")).toBe(false);
    expect(isGeocodable(null)).toBe(false);
  });

  it("reads the city out of a formatted address", () => {
    expect(cityFromFormatted("123 Main St, Palo Alto, CA 94301, USA")).toBe("Palo Alto");
    expect(cityFromFormatted("nowhere")).toBeNull();
  });

  it("maps route steps to legs, naming only an agency the line name states", () => {
    const route = routeToLegs({
      minutes: 20,
      steps: [
        { mode: "WALK", lineName: null, minutes: 5 },
        { mode: "TRANSIT", lineName: "Caltrain Local", minutes: 10 },
        { mode: "TRANSIT", lineName: "22", minutes: 5 },
        { mode: "DRIVE", lineName: null, minutes: 1 },
      ],
    });
    expect(route.legs).toEqual([
      { mode: "walk", agency: null, from: null, to: null },
      { mode: "transit", agency: "caltrain", from: null, to: null },
      { mode: "transit", agency: null, from: null, to: null },
    ]);
  });
});

describe("enrichListing", () => {
  const stop = (name: string, dLat: number): StopRow => ({
    stopId: name,
    feed: "f",
    name,
    lat: HOME.lat + dLat,
    lng: HOME.lng,
    modes: name === "Rail" ? ["rail"] : ["bus"],
    medianRushHeadwayMin: name === "Rail" ? 15 : null,
  });

  it("routes a walk for the nearest stop only and estimates the rest", async () => {
    const { geo, calls } = stubGeo();
    const result = await enrichListing(geo, {
      ...HOME,
      office: OFFICE,
      startDate: "2027-01-11",
      stops: [stop("Rail", 0.002), stop("Bus A", 0.004), stop("Bus B", 0.006)],
    });
    const stops = result.facts.find((f) => f.field === "nearbyStops");
    expect(stops?.provenance).toBe("estimate");
    expect(stops?.value).toEqual([
      { name: "Rail", walkMinutes: 7, rushHeadwayMinutes: 15, regionalRail: true },
      { name: "Bus A", walkMinutes: 8, rushHeadwayMinutes: null, regionalRail: false },
      { name: "Bus B", walkMinutes: 11, rushHeadwayMinutes: null, regionalRail: false },
    ]);
    expect(calls.walkBike.filter((m) => m === "WALK")).toHaveLength(4); // stop, grocery, gym, cafe
  });

  it("keeps stops Unknown when the stop table is empty or far away", async () => {
    const { geo } = stubGeo();
    const empty = await enrichListing(geo, { ...HOME, office: OFFICE, startDate: "2027-01-11", stops: [] });
    expect(empty.facts.find((f) => f.field === "nearbyStops")).toBeUndefined();
    const far = await enrichListing(geo, {
      ...HOME,
      office: OFFICE,
      startDate: "2027-01-11",
      stops: [{ ...stop("Far", 0), lat: HOME.lat + 2 }],
    });
    expect(far.facts.find((f) => f.field === "nearbyStops")).toBeUndefined();
  });

  it("known none nearby is an empty list, which the transit filter then fails", async () => {
    const { geo } = stubGeo();
    const result = await enrichListing(geo, {
      ...HOME,
      office: OFFICE,
      startDate: "2027-01-11",
      stops: [{ ...stop("Edge", 0), lat: HOME.lat + 0.05 }], // about 5.5 km away
    });
    expect(result.facts.find((f) => f.field === "nearbyStops")?.value).toEqual([]);
  });

  it("a failed transit call leaves the commute out and says why", async () => {
    const { geo } = stubGeo();
    const result = await enrichListing(
      { ...geo, transit: async () => ({ ok: false, error: "rate_limited" }) },
      { ...HOME, office: OFFICE, startDate: "2027-01-11", stops: [] },
    );
    expect(result.facts.find((f) => f.field === "commuteMinutes")).toBeUndefined();
    expect(result.notes).toContain("transit commute: rate_limited");
  });

  it("marks API-routed times api and straight-line ones estimate", async () => {
    const { geo } = stubGeo();
    const result = await enrichListing(geo, { ...HOME, office: OFFICE, startDate: "2027-01-11", stops: [] });
    const byField = Object.fromEntries(result.facts.map((f) => [f.field, f]));
    expect(byField.commuteMinutes?.provenance).toBe("api");
    expect(byField.groceryWalkMinutes?.provenance).toBe("api");
    expect(byField.gymWalkMinutes?.provenance).toBe("api");
    expect(byField.cafeWalkMinutes?.provenance).toBe("estimate"); // two cafes, one routed and one estimated
    expect(byField.cafeWalkMinutes?.value).toHaveLength(2);
  });
});
