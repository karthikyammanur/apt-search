import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDb, apiCache } from "@/db";
import { runMigrations } from "@/db/run-migrations";
import {
  createCachedFetch,
  requestHash,
  type Provider,
  type Request,
  type Transport,
} from "@/lib/providers/core";
import { createGoogle, googleRoutesSchema } from "@/lib/providers/google";
import { createTransitland } from "@/lib/providers/transitland";
import { createGeoapify } from "@/lib/providers/geoapify";
import { createFallbacks } from "@/lib/providers/fallbacks";
import { createSupost } from "@/lib/providers/supost";
import { createRentcast, rentcastAccessReason } from "@/lib/providers/rentcast";
import { createOverpass } from "@/lib/providers/overpass";
import { createGmail } from "@/lib/providers/gmail";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(path.join(process.cwd(), "tests/fixtures/providers", `${name}.json`), "utf8"),
  );
const from = { lat: 37.4292, lng: -122.1423 },
  to = { lat: 37.444215, lng: -122.1596371 };
const arriveBy = "2026-11-23T08:30:00-08:00";
const request: Request<z.infer<typeof googleRoutesSchema>> = {
  url: "https://routes.googleapis.com/directions/v2:computeRoutes",
  schema: googleRoutesSchema,
};
async function harness(
  responses: { body: unknown; status?: number; headers?: Record<string, string> }[] = [
    { body: fixture("google-transit") },
  ],
) {
  const db = createDb(":memory:");
  await runMigrations(db);
  let clock = Date.parse("2026-11-20T12:00:00Z");
  const network = vi.fn<typeof fetch>();
  for (const r of responses)
    network.mockResolvedValueOnce(
      new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers }),
    );
  const transport = createCachedFetch({ db: () => db, fetch: network, now: () => clock });
  return {
    db,
    network,
    transport,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("cached provider core", () => {
  it("serves a persistent cache hit without spending quota", async () => {
    const h = await harness();
    const first = await h.transport("google", request, 1000);
    const restarted = createCachedFetch({
      db: () => h.db,
      fetch: h.network,
      now: () => Date.parse("2026-11-20T12:00:00Z"),
    });
    expect(await restarted("google", request, 1000)).toEqual(first);
    expect(h.network).toHaveBeenCalledTimes(1);
    const rows = await h.db.select().from(apiCache);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("refetches after expiry", async () => {
    const h = await harness([
      { body: fixture("google-transit") },
      { body: fixture("google-walk") },
    ]);
    await h.transport("google", request, 1000);
    h.advance(1001);
    expect(await h.transport("google", request, 1000)).toMatchObject({
      ok: true,
      data: fixture("google-walk"),
    });
    expect(h.network).toHaveBeenCalledTimes(2);
  });
  it("rejects a malformed response with Zod and never caches it", async () => {
    const h = await harness([{ body: { routes: [{ duration: 123 }] } }]);
    expect(await h.transport("google", request, 1000)).toEqual({
      ok: false,
      error: "bad_response",
    });
    expect(await h.db.select().from(apiCache)).toHaveLength(0);
  });
  it("revalidates responses already in the cache", async () => {
    const h = await harness();
    await h.db.insert(apiCache).values({
      provider: "google",
      requestHash: requestHash(request),
      response: '{"routes":12}',
      fetchedAt: "2026-11-20T11:00:00Z",
      expiresAt: "2026-11-21T12:00:00Z",
    });
    expect(await h.transport("google", request, 1000)).toMatchObject({ ok: true });
    expect(h.network).toHaveBeenCalledTimes(1);
  });
  it("retries a 5xx once", async () => {
    const h = await harness([{ body: {}, status: 503 }, { body: fixture("google-transit") }]);
    expect(await h.transport("google", request, 1000)).toMatchObject({ ok: true });
    expect(h.network).toHaveBeenCalledTimes(2);
  });
  it("stops after two 5xx responses", async () => {
    const h = await harness([
      { body: {}, status: 503 },
      { body: {}, status: 503 },
    ]);
    expect(await h.transport("google", request, 1000)).toEqual({
      ok: false,
      error: "bad_response",
    });
    expect(h.network).toHaveBeenCalledTimes(2);
  });
  it.each([
    [404, "not_found"],
    [429, "rate_limited"],
    [403, "bad_response"],
  ])("maps HTTP %s", async (status, error) => {
    const h = await harness([{ body: {}, status: Number(status) }]);
    expect(await h.transport("google", request, 1000)).toEqual({ ok: false, error });
    expect(h.network).toHaveBeenCalledTimes(1);
  });
  it("honors Retry-After", async () => {
    const h = await harness([
      { body: {}, status: 429, headers: { "Retry-After": "120" } },
      { body: fixture("google-transit") },
    ]);
    await h.transport("google", request, 0);
    h.advance(61_000);
    expect(await h.transport("google", request, 0)).toEqual({ ok: false, error: "rate_limited" });
    h.advance(60_000);
    expect(await h.transport("google", request, 0)).toMatchObject({ ok: true });
  });
  it("enforces a provider budget across concurrent calls", async () => {
    const h = await harness([
      { body: fixture("google-transit") },
      { body: fixture("google-transit") },
    ]);
    const results = await Promise.all([1, 2, 3].map(() => h.transport("overpass", request, 0)));
    expect(results.filter((r) => !r.ok && r.error === "rate_limited")).toHaveLength(1);
    expect(h.network).toHaveBeenCalledTimes(2);
  });
  it("returns a typed network failure", async () => {
    const h = await harness([]);
    h.network.mockRejectedValue(new Error("private transport details"));
    expect(await h.transport("google", request, 0)).toEqual({ ok: false, error: "network" });
  });
  it("returns a typed failure if the cache is unavailable", async () => {
    const transport = createCachedFetch({
      db: () => {
        throw new Error("unavailable");
      },
    });
    expect(await transport("google", request, 1000)).toEqual({ ok: false, error: "network" });
  });
  it("canonicalizes query and header order without storing credentials", () => {
    const a = {
      ...request,
      url: "https://example.com/?b=2&a=1",
      init: { headers: { Authorization: "Bearer secret", Accept: "application/json" } },
    };
    const b = {
      ...a,
      url: "https://example.com/?a=1&b=2",
      init: { headers: { Accept: "application/json", Authorization: "Bearer secret" } },
    };
    expect(requestHash(a)).toEqual(requestHash(b));
    expect(requestHash(a)).not.toContain("secret");
  });
});

describe("clients and fallback contracts", () => {
  it("falls back from a daily Google quota to a recorded Transitland route", async () => {
    const h = await harness([
      {
        body: { error: { status: "RESOURCE_EXHAUSTED", message: "Daily quota exceeded" } },
        status: 429,
      },
      { body: fixture("transitland") },
    ]);
    const clients = {
      google: createGoogle({ key: "test", transport: h.transport }),
      transitland: createTransitland({ key: "test", transport: h.transport }),
      geoapify: createGeoapify({ key: "", transport: h.transport }),
    };
    expect(await createFallbacks(clients).getTransitCommute(from, to, arriveBy)).toMatchObject({
      ok: true,
      data: { provider: "transitland", minutes: 28 },
    });
    expect(await clients.google.route(from, to, "WALK")).toEqual({
      ok: false,
      error: "quota_paused",
    });
    expect(h.network).toHaveBeenCalledTimes(2);
    const url = new URL(String(h.network.mock.calls[1]?.[0]));
    expect(url.searchParams.get("arriveBy")).toBe("true");
    expect(url.searchParams.get("time")).toBe("08:30");
    expect(url.searchParams.get("date")).toBe("2026-11-23");
    expect(url.searchParams.get("useFallbackDates")).toBe("false");
    const restarted = createGoogle({
      key: "test",
      transport: createCachedFetch({
        db: () => h.db,
        fetch: h.network,
        now: () => Date.parse("2026-11-20T12:01:00Z"),
      }),
    });
    expect(await restarted.geocode("Example address")).toEqual({
      ok: false,
      error: "quota_paused",
    });
  });
  it("skips a blank Google key and uses Transitland", async () => {
    const h = await harness([{ body: fixture("transitland") }]);
    const clients = {
      google: createGoogle({ key: "", transport: h.transport }),
      transitland: createTransitland({ key: "test", transport: h.transport }),
      geoapify: createGeoapify({ key: "" }),
    };
    expect(await createFallbacks(clients).getTransitCommute(from, to, arriveBy)).toMatchObject({
      ok: true,
      data: { provider: "transitland" },
    });
    expect(h.network).toHaveBeenCalledTimes(1);
  });
  it("blank keys disable every keyed client without any network call", async () => {
    const h = await harness([]);
    const results = await Promise.all([
      createGoogle({ key: "", transport: h.transport }).geocode("Example"),
      createTransitland({ key: " ", transport: h.transport }).route(from, to, arriveBy),
      createGeoapify({ key: "", transport: h.transport }).route(from, to, "WALK"),
      createRentcast({ key: "", transport: h.transport }).listings(to),
      createGmail({ clientId: "", transport: h.transport }).listMessages(arriveBy),
    ]);
    expect(results).toEqual(results.map(() => ({ ok: false, error: "disabled" })));
    expect(h.network).not.toHaveBeenCalled();
  });
  it.each(["TRANSIT", "WALK", "BICYCLE"] as const)(
    "normalizes the recorded Google %s route and sets the field mask",
    async (mode) => {
      const h = await harness([
        {
          body: fixture(
            `google-${mode === "TRANSIT" ? "transit" : mode === "WALK" ? "walk" : "bicycle"}`,
          ),
        },
      ]);
      const result = await createGoogle({ key: "test", transport: h.transport }).route(
        from,
        to,
        mode,
        arriveBy,
      );
      expect(result).toMatchObject({
        ok: true,
        data: { minutes: expect.any(Number), steps: expect.any(Array) },
      });
      const init = h.network.mock.calls[0]?.[1];
      expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toContain("routes.duration");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        travelMode: mode,
        ...(mode === "TRANSIT" ? { arrivalTime: arriveBy } : {}),
      });
      if (mode !== "TRANSIT")
        expect(JSON.parse(String(init?.body))).not.toHaveProperty("arrivalTime");
    },
  );
  it("normalizes a v4 geocode", async () => {
    const h = await harness([{ body: fixture("google-geocode") }]);
    expect(
      await createGoogle({ key: "test", transport: h.transport }).geocode("Example address"),
    ).toMatchObject({ ok: true, data: { lat: expect.any(Number), lng: expect.any(Number) } });
    expect(String(h.network.mock.calls[0]?.[0])).toContain("/v4/geocode/address/");
  });
  it("validates recorded Places data", async () => {
    const h = await harness([{ body: fixture("google-places") }]);
    expect(await createGoogle({ key: "test", transport: h.transport }).nearby(to)).toMatchObject({
      ok: true,
      data: expect.any(Array),
    });
  });
  it.each(["rooms", "shares", "sublets"] as const)(
    "uses only supported SUPost %s search parameters",
    async (kind) => {
      const h = await harness([{ body: fixture("supost") }]);
      expect(await createSupost({ transport: h.transport }).listings(kind)).toMatchObject({
        ok: true,
      });
      const url = new URL(String(h.network.mock.calls[0]?.[0]));
      expect(url.pathname).toBe("/api/public/listings");
      expect(url.searchParams.get("cat")).toBe("housing");
      expect(url.searchParams.has("subcategory")).toBe(false);
    },
  );
  it("rejects invalid route inputs before making a request", async () => {
    const h = await harness([]);
    expect(
      await createGoogle({ key: "test", transport: h.transport }).route(
        { lat: 91, lng: 0 },
        to,
        "TRANSIT",
        arriveBy,
      ),
    ).toEqual({ ok: false, error: "bad_response" });
    expect(
      await createTransitland({ key: "test", transport: h.transport }).route(from, to, "yesterday"),
    ).toEqual({ ok: false, error: "bad_response" });
    expect(h.network).not.toHaveBeenCalled();
  });
  it("tries both Overpass endpoints with the same POST form and descriptive User-Agent", async () => {
    const calls: { provider: Provider; request: Request<unknown> }[] = [];
    const spy: Transport = async (provider, request) => {
      calls.push({ provider, request });
      return { ok: false, error: "network" };
    };
    await createOverpass({ transport: spy }).nearby(to);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => new URL(call.request.url).hostname)).toEqual([
      "overpass-api.de",
      "overpass.private.coffee",
    ]);
    expect(calls[0]?.request.init?.method).toBe("POST");
    expect(calls[1]?.request.init?.body).toBe(calls[0]?.request.init?.body);
    expect(new Headers(calls[0]?.request.init?.headers).get("User-Agent")).toContain(
      "ApartmentFinder",
    );
    const body = new URLSearchParams(String(calls[0]?.request.init?.body)).get("data");
    expect(body).toContain("fitness_centre");
    expect(body).toContain("amenity=cafe");
    expect(body).toContain("supermarket");
  });
  it("reserves the second Overpass request for fallback after an HTTP outage", async () => {
    const h = await harness([{ body: {}, status: 503 }, { body: { version: 0.6, elements: [] } }]);
    expect(await createOverpass({ transport: h.transport }).nearby(to)).toEqual({
      ok: true,
      data: { version: 0.6, elements: [] },
    });
    expect(h.network).toHaveBeenCalledTimes(2);
    expect(String(h.network.mock.calls[1]?.[0])).toContain("overpass.private.coffee");
  });
  it("does not call the backup after a successful Overpass request", async () => {
    const h = await harness([{ body: { version: 0.6, elements: [] } }]);
    expect(await createOverpass({ transport: h.transport }).nearby(to)).toMatchObject({ ok: true });
    expect(h.network).toHaveBeenCalledTimes(1);
  });
  it.each([401, 402, 403])("maps RentCast HTTP %s access errors to disabled", async (status) => {
    const h = await harness([
      { body: { status, error: "auth/error", message: "Add a payment method" }, status },
    ]);
    expect(await createRentcast({ key: "test", transport: h.transport }).listings(to)).toEqual({
      ok: false,
      error: "disabled",
    });
    expect(rentcastAccessReason({ message: "Add a payment method" }, status)).toContain(
      "payment method",
    );
    expect(rentcastAccessReason({ message: "Subscription not activated" }, status)).toContain(
      "not active",
    );
  });
  it("keeps malformed successful RentCast responses as bad_response and redacts diagnostics", async () => {
    const body = { message: "Private address or credential", status: 200 };
    const h = await harness([{ body }]);
    const diagnose = vi.fn();
    const transport: Transport = (provider, request, ttl) =>
      h.transport(provider, { ...request, diagnose }, ttl);
    expect(await createRentcast({ key: "test", transport }).listings(to)).toEqual({
      ok: false,
      error: "bad_response",
    });
    expect(diagnose).toHaveBeenCalledWith({
      elapsedMs: 0,
      status: 200,
      shape: { message: "string", status: "number" },
    });
    expect(JSON.stringify(diagnose.mock.calls)).not.toContain(body.message);
  });
  it("queries the latest Gmail label message without a date cutoff and handles an empty label", async () => {
    const h = await harness([
      { body: { access_token: "test", expires_in: 3600, token_type: "Bearer" } },
      { body: { resultSizeEstimate: 0 } },
    ]);
    const gmail = createGmail({
      clientId: "test",
      clientSecret: "test",
      refreshToken: "test",
      transport: h.transport,
    });
    expect(await gmail.listLatestMessages()).toEqual({ ok: true, data: { resultSizeEstimate: 0 } });
    const url = new URL(String(h.network.mock.calls[1]?.[0]));
    expect(url.searchParams.get("q")).toBe("label:housing-alerts");
    expect(url.searchParams.get("maxResults")).toBe("1");
  });
});

// Fallback selection tests reuse normalized recorded Google data as a client stub.
// Geoapify has no configured key, so these do not claim to test its live contract.
describe("walk, bike and geocode fallback selection", () => {
  it.each(["WALK", "BICYCLE"] as const)(
    "moves to Geoapify when Google is disabled for %s",
    async (mode) => {
      const h = await harness([
        { body: fixture(mode === "WALK" ? "google-walk" : "google-bicycle") },
      ]);
      const recorded = await createGoogle({ key: "test", transport: h.transport }).route(
        from,
        to,
        mode,
      );
      const backup = vi.fn().mockResolvedValue(recorded);
      const clients = {
        google: createGoogle({ key: "" }),
        transitland: createTransitland({ key: "" }),
        geoapify: { ...createGeoapify({ key: "" }), route: backup },
      };
      expect(await createFallbacks(clients).getWalkBike(from, to, mode)).toMatchObject({
        ok: true,
        data: { provider: "geoapify" },
      });
      expect(backup).toHaveBeenCalledWith(from, to, mode);
    },
  );
  it("moves to Geoapify geocoding when Google is disabled", async () => {
    const h = await harness([{ body: fixture("google-geocode") }]);
    const recorded = await createGoogle({ key: "test", transport: h.transport }).geocode("Example");
    const backup = vi.fn().mockResolvedValue(recorded);
    const clients = {
      google: createGoogle({ key: "" }),
      transitland: createTransitland({ key: "" }),
      geoapify: { ...createGeoapify({ key: "" }), geocode: backup },
    };
    expect(await createFallbacks(clients).geocode("Example")).toMatchObject({
      ok: true,
      data: { provider: "geoapify" },
    });
  });
  it("keeps unknown step durations and names null", async () => {
    const raw = structuredClone(fixture("google-walk")) as {
      routes: { legs: { steps: { staticDuration?: string }[] }[] }[];
    };
    delete raw.routes[0]!.legs[0]!.steps[0]!.staticDuration;
    const h = await harness([{ body: raw }]);
    expect(
      await createGoogle({ key: "test", transport: h.transport }).route(from, to, "WALK"),
    ).toMatchObject({
      ok: true,
      data: { steps: expect.arrayContaining([{ mode: "WALK", lineName: null, minutes: null }]) },
    });
  });
  it("requires a valid Gmail timestamp and message ID before authentication", async () => {
    const h = await harness([]);
    const gmail = createGmail({
      clientId: "test",
      clientSecret: "test",
      refreshToken: "test",
      transport: h.transport,
    });
    expect(await gmail.listMessages("yesterday")).toEqual({ ok: false, error: "bad_response" });
    expect(await gmail.getMessage("../invalid")).toEqual({ ok: false, error: "bad_response" });
    expect(h.network).not.toHaveBeenCalled();
  });
});

describe("cache fault and privacy handling", () => {
  it("refreshes a corrupt cached JSON body", async () => {
    const h = await harness();
    await h.db.insert(apiCache).values({
      provider: "google",
      requestHash: requestHash(request),
      response: "invalid json",
      fetchedAt: "2026-11-20T11:00:00Z",
      expiresAt: "2026-11-21T12:00:00Z",
    });
    expect(await h.transport("google", request, 1000)).toMatchObject({ ok: true });
  });
  it("keeps memory-only responses out of api_cache", async () => {
    const h = await harness();
    const memoryRequest = { ...request, memoryOnly: true };
    expect(await h.transport("google", memoryRequest, 1000)).toMatchObject({ ok: true });
    expect(await h.transport("google", memoryRequest, 1000)).toMatchObject({ ok: true });
    expect(h.network).toHaveBeenCalledTimes(1);
    expect(await h.db.select().from(apiCache)).toHaveLength(0);
  });
  it("uses a cached route even while the provider is paused", async () => {
    const h = await harness();
    const first = await h.transport("google", request, 1000);
    await h.db.insert(apiCache).values({
      provider: "google",
      requestHash: "quota_pause",
      response: "null",
      fetchedAt: "2026-11-20T11:00:00Z",
      expiresAt: "2026-11-21T12:00:00Z",
    });
    expect(await h.transport("google", request, 1000)).toEqual(first);
    expect(h.network).toHaveBeenCalledTimes(1);
  });
});
