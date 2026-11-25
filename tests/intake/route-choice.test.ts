// Among the itineraries within five minutes of the fastest, cost and commute use the one with the cheapest
// pass, and the listing says so. The planner's extra itineraries come from the provider clients.

import { describe, expect, it } from "vitest";
import { chooseRoute } from "@/lib/intake/enrich";
import { createTransitland } from "@/lib/providers/transitland";
import { ROUTE_CHOICE_WINDOW_MINUTES, type Route, type Transport } from "@/lib/providers";
import { bayAreaPack } from "@/lib/regions";

const from = { lat: 37.4419, lng: -122.1608 };
const to = { lat: 37.4419, lng: -122.143 };
const arriveBy = "2026-12-01T08:30:00-08:00";

const leg = (agency: string, line: string, seconds: number) => ({ mode: "BUS", duration: seconds, agencyName: agency, routeShortName: line });
const itinerary = (minutes: number, agency: string, line: string) => ({
  duration: minutes * 60,
  legs: [{ mode: "WALK", duration: 120 }, leg(agency, line, minutes * 60 - 240), { mode: "WALK", duration: 120 }],
});
const serving = (body: unknown): Transport => async (_provider, request) => {
  const parsed = request.schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "bad_response" };
};
const plan = (...itineraries: unknown[]) => createTransitland({ key: "test", transport: serving({ plan: { itineraries } }) }).route(from, to, arriveBy);

const route = (minutes: number, agency: string | null): Route => ({
  minutes,
  steps: [{ mode: "TRANSIT", lineName: "X", minutes, agencyName: agency }],
});

describe("Transitland returns the near-fastest alternatives too", () => {
  it("lists the fastest first, and the ones within five minutes as alternatives", async () => {
    expect(ROUTE_CHOICE_WINDOW_MINUTES).toBe(5);
    const result = await plan(itinerary(31, "VTA", "22"), itinerary(22, "VTA", "522"), itinerary(26, "Stanford Marguerite", "Y"), itinerary(27, "SamTrans", "ECR"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.minutes).toBe(22);
    expect(result.data.alternatives?.map((r) => r.minutes)).toEqual([26, 27]);
  });

  it("has no alternatives when nothing else is close", async () => {
    const result = await plan(itinerary(22, "VTA", "522"), itinerary(40, "VTA", "22"));
    expect(result.ok && result.data.alternatives).toBeUndefined();
  });
});

describe("choosing the route by pass", () => {
  const vta = route(22, "VTA");
  const marguerite = route(26, "Stanford Marguerite");

  it("takes the cheaper pass among routes within five minutes, and says what it cost in time", () => {
    const choice = chooseRoute({ ...vta, alternatives: [marguerite] }, bayAreaPack);
    expect(choice.route.minutes).toBe(26);
    expect(choice.route.alternatives).toBeUndefined();
    expect(choice.note).toMatch(/^Chosen for the cheaper pass, \$\d+ a month less; 4 min slower than the fastest route$/);
  });

  it("keeps the fastest when its pass is as cheap", () => {
    const choice = chooseRoute({ ...marguerite, alternatives: [route(27, "Stanford Marguerite")] }, bayAreaPack);
    expect(choice.route.minutes).toBe(26);
    expect(choice.note).toBeNull();
  });

  it("keeps the fastest with no alternatives or no region pack", () => {
    expect(chooseRoute(vta, bayAreaPack)).toEqual({ route: vta, note: null });
    expect(chooseRoute({ ...vta, alternatives: [marguerite] }, undefined)).toMatchObject({ route: { minutes: 22 }, note: null });
  });

  it("never prefers a route whose pass cannot be priced", () => {
    const unpriced = route(23, "AC Transit");
    expect(chooseRoute({ ...vta, alternatives: [unpriced] }, bayAreaPack).route.minutes).toBe(22);
    // And when the fastest is the one that cannot be priced, a priced alternative wins.
    const choice = chooseRoute({ ...unpriced, alternatives: [vta] }, bayAreaPack);
    expect(choice.route.minutes).toBe(22);
    expect(choice.note).toMatch(/^Chosen for the cheaper pass; /);
  });
});
