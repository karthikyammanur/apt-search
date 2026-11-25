// The Google Maps Demo Key's terms forbid production use, so on any Vercel deployment Google is never
// called. These tests stub the clients and record which ones are asked, in order.

import { describe, expect, it } from "vitest";
import { createFallbacks, googleMode } from "@/lib/providers/fallbacks";
import { createPlaces } from "@/lib/intake/geo";
import type { Result } from "@/lib/providers";

const from = { lat: 37.4, lng: -122.1 };
const to = { lat: 37.44, lng: -122.16 };
const arriveBy = "2026-12-01T09:00:00-08:00";

const PRODUCTION = { VERCEL: "1", VERCEL_ENV: "production" };
const PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview" };

const route = (minutes: number): Result<{ minutes: number; steps: [] }> => ({ ok: true, data: { minutes, steps: [] } });
const down: Result<never> = { ok: false, error: "network" };

function stubs(calls: string[], opts: { google?: Result<never> | "ok"; free?: Result<never> | "ok" } = {}) {
  const answer = (who: string, minutes: number, mode: Result<never> | "ok" | undefined) => {
    calls.push(who);
    return Promise.resolve(mode === undefined || mode === "ok" ? route(minutes) : mode);
  };
  return {
    google: {
      route: () => answer("google", 10, opts.google),
      geocode: () => {
        calls.push("google");
        return Promise.resolve(
          opts.google && opts.google !== "ok" ? opts.google : ({ ok: true, data: { lat: 1, lng: 2, address: "g" } } as const),
        );
      },
    },
    transitland: { route: () => answer("transitland", 20, opts.free) },
    geoapify: {
      route: () => answer("geoapify", 30, opts.free),
      geocode: () => {
        calls.push("geoapify");
        return Promise.resolve(
          opts.free && opts.free !== "ok" ? opts.free : ({ ok: true, data: { lat: 3, lng: 4, address: "f" } } as const),
        );
      },
    },
  } as never;
}

describe("googleMode", () => {
  it("is primary on a laptop and after a Vercel dev pull, and off on every Vercel deployment", () => {
    expect(googleMode({})).toBe("primary");
    expect(googleMode({ VERCEL: "1", VERCEL_ENV: "development" })).toBe("primary");
    expect(googleMode(PREVIEW)).toBe("off");
    expect(googleMode(PRODUCTION)).toBe("off");
  });

  it("fails closed: Vercel with no VERCEL_ENV counts as production", () => {
    expect(googleMode({ VERCEL: "1" })).toBe("off");
  });
});

describe("transit, walk, bike and geocode order", () => {
  it.each([
    ["production", PRODUCTION],
    ["preview", PREVIEW],
  ])("%s: the free providers only, Google is never called, even when they fail", async (_name, env) => {
    const calls: string[] = [];
    const ok = createFallbacks(stubs(calls), env);
    expect(await ok.getTransitCommute(from, to, arriveBy)).toMatchObject({ ok: true, data: { minutes: 20, provider: "transitland" } });
    expect(await ok.getWalkBike(from, to, "WALK")).toMatchObject({ ok: true, data: { minutes: 30, provider: "geoapify" } });
    expect(await ok.geocode("Example")).toMatchObject({ ok: true, data: { lat: 3, provider: "geoapify" } });

    const failing = createFallbacks(stubs(calls, { free: down }), env);
    expect(await failing.getTransitCommute(from, to, arriveBy)).toEqual({ ok: false, error: "network" });
    expect(await failing.getWalkBike(from, to, "BICYCLE")).toEqual({ ok: false, error: "network" });
    expect(await failing.geocode("Example")).toEqual({ ok: false, error: "network" });
    expect(calls).not.toContain("google");
  });

  it("laptop: Google first, the free providers as backup (unchanged)", async () => {
    const calls: string[] = [];
    await createFallbacks(stubs(calls), {}).getWalkBike(from, to, "WALK");
    expect(calls).toEqual(["google"]);

    calls.length = 0;
    const result = await createFallbacks(stubs(calls, { google: down }), {}).getWalkBike(from, to, "WALK");
    expect(calls).toEqual(["google", "geoapify"]);
    expect(result).toMatchObject({ ok: true, data: { provider: "geoapify" } });
  });
});

describe("nearby places order", () => {
  const place = { type: "node" as const, id: 1, lat: 37.4, lon: -122.1, tags: { shop: "supermarket", name: "Market" } };
  const geoapifyPlace = (categories: string[], name: string | null = "Geo") => ({
    id: `p-${categories[0]}`,
    name,
    lat: 37.4,
    lng: -122.1,
    categories,
  });

  function clients(calls: string[], overpass: "ok" | "down", geoapify: "ok" | "down" = "ok") {
    return {
      google: {
        nearby: () => {
          calls.push("google");
          return Promise.resolve({
            ok: true,
            data: [{ id: "g1", name: "G Market", lat: 1, lng: 2, types: ["grocery_store"], rating: 4.5 }],
          });
        },
      },
      overpass: {
        nearby: () => {
          calls.push("overpass");
          return Promise.resolve(overpass === "ok" ? { ok: true, data: { version: 0.6, elements: [place] } } : down);
        },
      },
      geoapify: {
        places: () => {
          calls.push("geoapify");
          return Promise.resolve(
            geoapify === "ok"
              ? {
                  ok: true,
                  data: [
                    geoapifyPlace(["commercial", "commercial.supermarket"], "Geo Market"),
                    geoapifyPlace(["sport", "sport.fitness", "sport.fitness.fitness_centre"], "Geo Gym"),
                    geoapifyPlace(["catering", "catering.cafe"], null),
                    geoapifyPlace(["commercial.clothing"], "Not Wanted"),
                  ],
                }
              : down,
          );
        },
      },
    } as never;
  }

  it.each([
    ["production", PRODUCTION],
    ["preview", PREVIEW],
  ])("%s: Overpass first, mapped to the app's place kinds, and never Google", async (_name, env) => {
    const calls: string[] = [];
    const found = await createPlaces(clients(calls, "ok"), env)(from, 1500);
    expect(found).toEqual({
      ok: true,
      data: [{ id: "node/1", name: "Market", lat: 37.4, lng: -122.1, types: ["grocery_store"], rating: null }],
    });
    expect(calls).toEqual(["overpass"]);
  });

  it("falls back to Geoapify Places when Overpass fails, and maps its categories", async () => {
    const calls: string[] = [];
    const found = await createPlaces(clients(calls, "down"), PRODUCTION)(from, 1500);
    expect(calls).toEqual(["overpass", "geoapify"]);
    expect(found).toEqual({
      ok: true,
      data: [
        { id: "p-commercial", name: "Geo Market", lat: 37.4, lng: -122.1, types: ["grocery_store"], rating: null },
        { id: "p-sport", name: "Geo Gym", lat: 37.4, lng: -122.1, types: ["gym"], rating: null },
        { id: "p-catering", name: "cafe", lat: 37.4, lng: -122.1, types: ["cafe"], rating: null },
      ],
    });
  });

  it("is an error only when Overpass and Geoapify both fail, and Google is still not tried in production", async () => {
    const calls: string[] = [];
    const found = await createPlaces(clients(calls, "down", "down"), PRODUCTION)(from, 1500);
    expect(found).toEqual({ ok: false, error: "network" });
    expect(calls).toEqual(["overpass", "geoapify"]);
  });

  it("laptop: Google first, then Overpass, then Geoapify", async () => {
    const first: string[] = [];
    await createPlaces(clients(first, "ok"), {})(from, 1500);
    expect(first).toEqual(["google"]);

    // Make Google fail by stubbing it down.
    const calls: string[] = [];
    const base = clients(calls, "down") as unknown as Record<string, unknown>;
    const withGoogleDown = { ...base, google: { nearby: () => (calls.push("google"), Promise.resolve(down)) } } as never;
    await createPlaces(withGoogleDown, {})(from, 1500);
    expect(calls).toEqual(["google", "overpass", "geoapify"]);
  });
});
