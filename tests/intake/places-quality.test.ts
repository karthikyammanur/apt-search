// Nearby places: gyms are found, grocery means supermarkets, and a kind a free source could not find is
// "not checked" (Unknown), never 0 or "none".

import { describe, expect, it } from "vitest";
import { enrichListing } from "@/lib/intake/enrich";
import { createPlaces, geoapifyKind, googlePlaceKinds, isGroceryStore, overpassKind, type Geo, type Place } from "@/lib/intake/geo";
import { createOverpass } from "@/lib/providers/overpass";
import type { Request, Transport } from "@/lib/providers";
import { stubGeo, HOME, OFFICE } from "./helpers";

const center = { lat: 37.4, lng: -122.1 };
const down = { ok: false, error: "network" } as const;

describe("which OpenStreetMap elements are gyms and grocery stores", () => {
  it.each([
    [{ leisure: "fitness_centre" }, "gym"],
    [{ amenity: "gym" }, "gym"],
    [{ leisure: "sports_centre", sport: "fitness" }, "gym"],
    [{ leisure: "sports_centre", sport: "tennis;fitness" }, "gym"],
    [{ leisure: "sports_centre", sport: "tennis" }, null],
    [{ leisure: "sports_centre" }, null],
    [{ shop: "supermarket" }, "grocery_store"],
    [{ shop: "grocery" }, "grocery_store"],
    [{ shop: "convenience" }, null],
    [{ amenity: "fuel", shop: "convenience" }, null],
    [{ amenity: "cafe" }, "cafe"],
  ])("%j is %s", (tags, kind) => {
    expect(overpassKind(tags)).toBe(kind);
  });

  it("asks Overpass for gyms three ways and no longer for convenience stores", async () => {
    let body = "";
    const spy: Transport = async (_provider, request: Request<unknown>) => {
      body = decodeURIComponent(String(request.init?.body ?? "")).replace(/\+/g, " ");
      return { ok: false, error: "network" };
    };
    await createOverpass({ transport: spy }).nearby(center);
    expect(body).toContain("leisure=fitness_centre");
    expect(body).toContain("amenity=gym");
    expect(body).toContain('leisure=sports_centre][sport~"fitness"');
    expect(body).toContain("supermarket|grocery");
    expect(body).not.toContain("convenience");
  });
});

describe("grocery means supermarkets and grocery stores", () => {
  it.each([
    [["supermarket", "grocery_store", "food_store"], true],
    [["grocery_store", "food_store"], true],
    [["convenience_store", "grocery_store", "food_store"], false],
    [["gas_station", "convenience_store", "grocery_store"], false],
    [["grocery_store", "gas_station"], false],
    [["cafe"], false],
  ])("%j is a grocery store: %s", (types, expected) => {
    expect(isGroceryStore(types)).toBe(expected);
  });

  it("takes the grocery kind off Google's convenience stores and gas stations, and keeps the rest", () => {
    const place = (id: string, types: string[]): Place => ({ id, name: id, lat: 1, lng: 2, types, rating: null });
    const kept = googlePlaceKinds([
      place("safeway", ["supermarket", "grocery_store"]),
      place("seven-eleven", ["convenience_store", "grocery_store"]),
      place("shell", ["gas_station", "convenience_store", "grocery_store"]),
      place("gym", ["gym"]),
      place("market-cafe", ["grocery_store", "gas_station", "cafe"]),
    ]);
    expect(kept.map((p) => [p.id, p.types])).toEqual([
      ["safeway", ["supermarket", "grocery_store"]],
      ["gym", ["gym"]],
      ["market-cafe", ["gas_station", "cafe"]],
    ]);
  });

  it("maps Geoapify's categories to the same kinds", () => {
    expect(geoapifyKind(["commercial", "commercial.supermarket"])).toBe("grocery_store");
    expect(geoapifyKind(["commercial.convenience"])).toBeNull();
    expect(geoapifyKind(["sport", "sport.fitness", "sport.fitness.fitness_centre"])).toBe("gym");
    expect(geoapifyKind(["sport.sports_centre"])).toBeNull();
  });
});

describe("Geoapify is asked once per kind, so gyms are not crowded out", () => {
  const gym = { id: "gym1", name: "Example Gym", lat: 37.4, lng: -122.1, categories: ["sport", "sport.fitness"] };
  const market = { id: "m1", name: "Example Market", lat: 37.4, lng: -122.1, categories: ["commercial.supermarket"] };
  const asked: string[] = [];
  const geoapify = (answer: (categories: string) => unknown) =>
    ({
      places: async (_c: unknown, _r: unknown, categories: string) => {
        asked.push(categories);
        return answer(categories);
      },
    }) as never;
  const noOverpass = { nearby: async () => down } as never;
  const noGoogle = { nearby: async () => down } as never;
  const run = (client: never) => createPlaces({ google: noGoogle, overpass: noOverpass, geoapify: client }, { VERCEL: "1" })(center, 1500);

  it("asks for supermarkets, fitness and cafes separately", async () => {
    asked.length = 0;
    await run(geoapify(() => ({ ok: true, data: [] })));
    expect(asked).toEqual(["commercial.supermarket", "sport.fitness", "catering.cafe"]);
  });

  it("marks the kinds that came back empty as not checked, and keeps the ones it found", async () => {
    const found = await run(geoapify((c) => ({ ok: true, data: c === "commercial.supermarket" ? [market] : [] })));
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.data.map((p) => p.name)).toEqual(["Example Market"]);
    expect(found.data.notChecked).toEqual(["gym", "cafe"]);
  });

  it("marks a kind whose request failed as not checked, and finds the gym that did answer", async () => {
    const found = await run(geoapify((c) => (c === "sport.fitness" ? { ok: true, data: [gym] } : down)));
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.data.map((p) => p.types)).toEqual([["gym"]]);
    expect(found.data.notChecked).toEqual(["grocery_store", "cafe"]);
  });

  it("is a failure only when every request failed", async () => {
    expect(await run(geoapify(() => down))).toEqual(down);
  });

  it("does not say not checked when Google answered, even for an empty kind", async () => {
    const google = { nearby: async () => ({ ok: true, data: [{ id: "g", name: "G", lat: 1, lng: 2, types: ["cafe"], rating: null }] }) } as never;
    const found = await createPlaces({ google, overpass: noOverpass, geoapify: geoapify(() => down) }, {})(center, 1500);
    expect(found.ok && found.data.notChecked).toBeFalsy();
  });
});

describe("a kind that was not checked is Unknown, never 0", () => {
  const withPlaces = (places: Place[] & { notChecked?: ("grocery_store" | "gym" | "cafe")[] }): Geo => ({
    ...stubGeo().geo,
    places: async () => ({ ok: true, data: places }),
  });
  const input = { lat: HOME.lat, lng: HOME.lng, office: OFFICE, startDate: "2027-01-02", stops: [] };
  const market: Place = { id: "m", name: "Example Market", lat: HOME.lat + 0.003, lng: HOME.lng, types: ["grocery_store"], rating: null };

  it("writes no gym or cafe fact and records what was not checked", async () => {
    const places = Object.assign([market], { notChecked: ["gym" as const, "cafe" as const] });
    const result = await enrichListing(withPlaces(places), input);
    const fields = result.facts.map((f) => f.field);
    expect(fields).toContain("groceryWalkMinutes");
    expect(fields).not.toContain("gymWalkMinutes");
    expect(fields).not.toContain("cafeWalkMinutes");
    expect(result.columns.pois).toMatchObject({ gym: null, cafes: [], notChecked: ["gym", "cafe"] });
  });

  it("keeps the cafe result of a source that vouches for it, even when empty", async () => {
    const result = await enrichListing(withPlaces([market]), input);
    expect(result.facts.find((f) => f.field === "cafeWalkMinutes")?.value).toEqual([]);
    expect(result.columns.pois?.notChecked).toEqual([]);
  });

  it("does not call a kind not checked when it was found after all", async () => {
    const gym: Place = { id: "g", name: "Example Gym", lat: HOME.lat, lng: HOME.lng + 0.004, types: ["gym"], rating: null };
    const places = Object.assign([market, gym], { notChecked: ["gym" as const] });
    const result = await enrichListing(withPlaces(places), input);
    expect(result.facts.map((f) => f.field)).toContain("gymWalkMinutes");
    expect(result.columns.pois?.notChecked).toEqual([]);
  });
});
