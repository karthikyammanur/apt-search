import { describe, expect, it } from "vitest";
import { roundHalfUp, ratFrac } from "@/lib/domain/rational";
import { bayAreaPack, caltrainZone, getRegionPack } from "@/lib/regions";
import { SOURCES } from "@/lib/regions/bay-area";
import type { TransitLeg } from "@/lib/regions";

describe("Caltrain zones", () => {
  it.each([
    { station: "Redwood City", zone: 2 },
    { station: "Menlo Park", zone: 3 },
    { station: "Palo Alto Caltrain Station", zone: 3 },
    { station: "California Avenue", zone: 3 },
    { station: "California Ave", zone: 3 },
    { station: "San Antonio", zone: 3 },
    { station: "Mountain View", zone: 3 },
    { station: "Sunnyvale", zone: 3 },
    { station: "San Jose Diridon", zone: null },
  ])("$station is zone $zone", ({ station, zone }) => {
    expect(caltrainZone(station)).toBe(zone);
  });
});

describe("cheapest pass", () => {
  const leg = (agency: string, from?: string, to?: string): TransitLeg => ({ mode: "transit", agency, from, to });
  it.each([
    { name: "walk only", legs: [{ mode: "walk" } as TransitLeg], cents: 0 },
    { name: "Caltrain within zone 3", legs: [leg("caltrain", "Mountain View", "Palo Alto")], cents: 9600 },
    { name: "Caltrain zone 2 to 3", legs: [leg("caltrain", "Redwood City", "California Ave")], cents: 15000 },
    { name: "VTA bus", legs: [leg("vta")], cents: 9000 },
    { name: "SamTrans bus", legs: [leg("samtrans")], cents: 6560 },
    { name: "Marguerite shuttle", legs: [leg("marguerite")], cents: 0 },
    { name: "Caltrain plus Marguerite", legs: [leg("caltrain", "Menlo Park", "Palo Alto"), leg("marguerite")], cents: 9600 },
    { name: "SamTrans plus Caltrain 2 zones", legs: [leg("samtrans"), leg("caltrain", "Redwood City", "Palo Alto")], cents: 21560 },
    { name: "two VTA legs need one pass", legs: [leg("vta"), leg("vta")], cents: 9000 },
  ])("$name costs $cents", ({ legs, cents }) => {
    const choice = bayAreaPack.cheapestPass({ legs });
    expect(choice).toMatchObject({ status: "estimate", monthlyCents: cents });
  });

  it.each([
    { name: "unknown agency", legs: [leg("ac transit")] },
    { name: "unknown station", legs: [leg("caltrain", "San Jose Diridon", "Palo Alto")] },
    { name: "missing station", legs: [leg("caltrain", "Palo Alto")] },
  ])("$name is Unknown", ({ legs }) => {
    expect(bayAreaPack.cheapestPass({ legs }).status).toBe("unknown");
  });
});

describe("estimates", () => {
  it.each([
    { name: "internet", amount: bayAreaPack.internetMonthly(), cents: 4500 },
    { name: "renter's insurance", amount: bayAreaPack.rentersInsuranceMonthly(), cents: 1500 },
    { name: "utilities, Mountain View, 3 people", amount: bayAreaPack.utilitiesMonthly({ city: "Mountain View", householdSize: 3 }), cents: 15233 },
    { name: "utilities, Redwood City, one person's share", amount: bayAreaPack.utilitiesMonthly({ city: "Redwood City", householdSize: 1 }), cents: 21216 },
  ])("$name is $cents cents, estimated", ({ amount, cents }) => {
    expect(amount.status).toBe("estimate");
    if (amount.status === "estimate") expect(roundHalfUp(amount.monthlyCents)).toBe(cents);
  });

  it("every source has an https URL and an ISO as-of date", () => {
    for (const source of Object.values(SOURCES)) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("regions without a pack", () => {
  it("returns Unknown for everything", () => {
    const pack = getRegionPack("los-angeles");
    expect(pack.hasData).toBe(false);
    expect(pack.utilitiesMonthly({ city: "Los Angeles", householdSize: 2 }).status).toBe("unknown");
    expect(pack.internetMonthly().status).toBe("unknown");
    expect(pack.rentersInsuranceMonthly().status).toBe("unknown");
    expect(pack.cheapestPass({ legs: [] }).status).toBe("unknown");
  });

  it("returns the Bay Area pack by id", () => {
    expect(getRegionPack("bay-area")).toBe(bayAreaPack);
  });
});

describe("region names and aliases", () => {
  it.each([
    "palo alto",
    "Palo Alto",
    "PALO ALTO",
    "  Palo   Alto  ",
    "Palo Alto, CA",
    "palo-alto",
    "Stanford",
    "EVGR",
    "Menlo Park",
    "Mountain View",
    "Sunnyvale",
    "Redwood City",
    "San Jose",
    "Bay Area",
    "San Francisco Bay Area",
    "BAY-AREA",
  ])("%s is the Bay Area pack", (name) => {
    expect(getRegionPack(name)).toBe(bayAreaPack);
  });

  it("prices a pass and the extras for a city name, instead of saying there is no pack", () => {
    const pack = getRegionPack("palo alto");
    expect(pack.hasData).toBe(true);
    expect(pack.internetMonthly().status).toBe("estimate");
    expect(pack.cheapestPass({ legs: [{ mode: "transit", agency: "vta" }] })).toMatchObject({ status: "estimate" });
  });

  it("still answers Unknown for a place no pack covers, and says which", () => {
    const pack = getRegionPack("Los Angeles");
    expect(pack.hasData).toBe(false);
    expect(pack.internetMonthly()).toMatchObject({ status: "unknown", reason: expect.stringContaining("Los Angeles") });
    expect(getRegionPack("")).toMatchObject({ hasData: false });
  });
});

describe("rounding", () => {
  it.each([
    { n: 1, d: 2, out: 1 },
    { n: 3, d: 2, out: 2 },
    { n: 2499, d: 1000, out: 2 },
    { n: 0, d: 7, out: 0 },
    { n: -1, d: 2, out: 0 },
  ])("roundHalfUp($n / $d) = $out", ({ n, d, out }) => {
    expect(roundHalfUp(ratFrac(n, d))).toBe(out);
  });
});
