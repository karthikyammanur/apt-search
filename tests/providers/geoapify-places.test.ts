// Geoapify Places is the last fallback for nearby places. These tests use a recorded response
// (trimmed to the fields the client reads) and check the request it builds and how it maps results.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGeoapify, GEOAPIFY_PLACE_CATEGORIES } from "@/lib/providers/geoapify";
import type { Transport } from "@/lib/providers";

const body = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "providers", "geoapify-places.json"), "utf8"));
const center = { lat: 37.4261, lng: -122.1453 };

function recording(reply: unknown = body) {
  const urls: string[] = [];
  const transport: Transport = async (_provider, request) => {
    urls.push(request.url);
    const parsed = request.schema.safeParse(reply);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "bad_response" };
  };
  return { urls, transport };
}

describe("Geoapify places", () => {
  it("asks for supermarkets, fitness centres and cafes inside a circle, nearest first", async () => {
    const { urls, transport } = recording();
    await createGeoapify({ key: "test", transport }).places(center, 1200);
    const url = new URL(urls[0]!);
    expect(url.origin + url.pathname).toBe("https://api.geoapify.com/v2/places");
    expect(url.searchParams.get("categories")).toBe(GEOAPIFY_PLACE_CATEGORIES);
    expect(url.searchParams.get("filter")).toBe("circle:-122.1453,37.4261,1200");
    expect(url.searchParams.get("bias")).toBe("proximity:-122.1453,37.4261");
  });

  it("maps the recorded features to places with their categories", async () => {
    const { transport } = recording();
    const result = await createGeoapify({ key: "test", transport }).places(center);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.map((p) => [p.name, p.lat, p.lng])).toEqual([
      ["Country Sun", 37.4261728, -122.1453804],
      ["Ume Go", 37.4261307, -122.1447183],
    ]);
    expect(result.data[0]?.categories).toContain("commercial.supermarket");
    expect(result.data[1]?.categories).toContain("catering.cafe");
  });

  it("keeps a place without a name as null, not an empty name", async () => {
    const { transport } = recording({ features: [{ properties: { place_id: "p1", categories: ["catering.cafe"], lat: 37.4, lon: -122.1 } }] });
    const result = await createGeoapify({ key: "test", transport }).places(center);
    expect(result).toMatchObject({ ok: true, data: [{ id: "p1", name: null }] });
  });

  it("is disabled without a key and never calls the network", async () => {
    const { urls, transport } = recording();
    expect(await createGeoapify({ key: "", transport }).places(center)).toEqual({ ok: false, error: "disabled" });
    expect(urls).toHaveLength(0);
  });

  it("rejects a response that is not a features list", async () => {
    const { transport } = recording({ nope: true });
    expect(await createGeoapify({ key: "test", transport }).places(center)).toMatchObject({ ok: false });
  });

  it("rejects a center outside the map", async () => {
    const { urls, transport } = recording();
    expect(await createGeoapify({ key: "test", transport }).places({ lat: 123, lng: 0 })).toEqual({ ok: false, error: "bad_response" });
    expect(urls).toHaveLength(0);
  });
});
