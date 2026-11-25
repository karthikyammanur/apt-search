// The Google Maps Demo Key's terms forbid production use, so on Vercel production Google is never
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
  it("is primary on a laptop and after a Vercel dev pull, fallback on preview, off on production", () => {
    expect(googleMode({})).toBe("primary");
    expect(googleMode({ VERCEL: "1", VERCEL_ENV: "development" })).toBe("primary");
    expect(googleMode(PREVIEW)).toBe("fallback");
    expect(googleMode(PRODUCTION)).toBe("off");
  });

  it("fails closed: Vercel with no VERCEL_ENV counts as production", () => {
    expect(googleMode({ VERCEL: "1" })).toBe("off");
  });
});

describe("transit, walk, bike and geocode order", () => {
  it("production: the free providers only, Google is never called, even when they fail", async () => {
    const calls: string[] = [];
    const ok = createFallbacks(stubs(calls), PRODUCTION);
    expect(await ok.getTransitCommute(from, to, arriveBy)).toMatchObject({ ok: true, data: { minutes: 20, provider: "transitland" } });
    expect(await ok.getWalkBike(from, to, "WALK")).toMatchObject({ ok: true, data: { minutes: 30, provider: "geoapify" } });
    expect(await ok.geocode("Example")).toMatchObject({ ok: true, data: { lat: 3, provider: "geoapify" } });

    const failing = createFallbacks(stubs(calls, { free: down }), PRODUCTION);
    expect(await failing.getTransitCommute(from, to, arriveBy)).toEqual({ ok: false, error: "network" });
    expect(await failing.getWalkBike(from, to, "BICYCLE")).toEqual({ ok: false, error: "network" });
    expect(await failing.geocode("Example")).toEqual({ ok: false, error: "network" });
    expect(calls).not.toContain("google");
  });

  it("preview: the free providers first, Google only when they fail", async () => {
    const calls: string[] = [];
    await createFallbacks(stubs(calls), PREVIEW).getTransitCommute(from, to, arriveBy);
    expect(calls).toEqual(["transitland"]);

    calls.length = 0;
    const result = await createFallbacks(stubs(calls, { free: down }), PREVIEW).getTransitCommute(from, to, arriveBy);
    expect(calls).toEqual(["transitland", "google"]);
    expect(result).toMatchObject({ ok: true, data: { minutes: 10, provider: "google" } });
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
  const clients = (calls: string[], overpassOk: boolean) =>
    ({
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
          return Promise.resolve(overpassOk ? { ok: true, data: { version: 0.6, elements: [place] } } : down);
        },
      },
    }) as never;

  it("production: Overpass only, mapped to the app's place kinds, never Google", async () => {
    const calls: string[] = [];
    const found = await createPlaces(clients(calls, true), PRODUCTION)(from, 1500);
    expect(found).toEqual({
      ok: true,
      data: [{ id: "node/1", name: "Market", lat: 37.4, lng: -122.1, types: ["grocery_store"], rating: null }],
    });
    const failed = await createPlaces(clients(calls, false), PRODUCTION)(from, 1500);
    expect(failed).toEqual({ ok: false, error: "network" });
    expect(calls).toEqual(["overpass", "overpass"]);
  });

  it("preview: Overpass first, then Google; laptop: Google first, then Overpass", async () => {
    const preview: string[] = [];
    await createPlaces(clients(preview, false), PREVIEW)(from, 1500);
    expect(preview).toEqual(["overpass", "google"]);

    const laptop: string[] = [];
    await createPlaces(clients(laptop, true), {})(from, 1500);
    expect(laptop).toEqual(["google"]);
  });
});
