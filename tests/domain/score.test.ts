import { describe, expect, it } from "vitest";
import {
  budgetHeadroomScore,
  cafesScore,
  computeCost,
  explain,
  leaseFitScore,
  linearDown,
  normalizeWeights,
  reviewsTrustScore,
  scoreListing,
  transitQualityScore,
  type ListingFacts,
  type ScoreBreakdown,
  type Weights,
} from "@/lib/domain";
import { bayAreaPack } from "@/lib/regions";
import { allScamChecksPass, cleanListing, equalWeights, f, settings } from "./fixtures";

const L = (overrides: Partial<ListingFacts> = {}) => cleanListing(overrides);

describe("curves", () => {
  it.each([
    { x: 10, full: 15, zero: 30, y: 1 },
    { x: 15, full: 15, zero: 30, y: 1 },
    { x: 22.5, full: 15, zero: 30, y: 0.5 },
    { x: 30, full: 15, zero: 30, y: 0 },
    { x: 40, full: 15, zero: 30, y: 0 },
  ])("linearDown($x, $full, $zero) = $y", ({ x, full, zero, y }) => {
    expect(linearDown(x, full, zero)).toBeCloseTo(y, 12);
  });

  it.each([
    { name: "Caltrain 4 min walk", stops: [{ walkMinutes: 4, rushHeadwayMinutes: 40, regionalRail: true }], score: 1 },
    { name: "frequent bus 5 min walk", stops: [{ walkMinutes: 5, rushHeadwayMinutes: 15, regionalRail: false }], score: 1 },
    { name: "stop at 10 min, every 30 min", stops: [{ walkMinutes: 10, rushHeadwayMinutes: 30, regionalRail: false }], score: 0 },
    { name: "near but slow", stops: [{ walkMinutes: 5, rushHeadwayMinutes: 30, regionalRail: false }], score: 0.5 },
    { name: "best of two stops", stops: [{ walkMinutes: 10, rushHeadwayMinutes: 30, regionalRail: false }, { walkMinutes: 7.5, rushHeadwayMinutes: 15, regionalRail: false }], score: 0.75 },
    { name: "frequency Unknown", stops: [{ walkMinutes: 3, rushHeadwayMinutes: null, regionalRail: false }], score: null },
  ])("transit quality: $name", ({ stops, score }) => {
    const result = transitQualityScore(L({ nearbyStops: f(stops, "api") })).score;
    if (score === null) expect(result).toBeNull();
    else expect(result).toBeCloseTo(score, 12);
  });

  it.each([
    { walks: [1, 2, 10], score: 1 },
    { walks: [1, 2], score: 2 / 3 },
    { walks: [12.5], score: 0.5 / 3 },
    { walks: [16, 20], score: 0 },
    { walks: [], score: 0 },
  ])("cafes at $walks score $score", ({ walks, score }) => {
    expect(cafesScore(L({ cafeWalkMinutes: f(walks, "api") })).score).toBeCloseTo(score, 12);
  });

  it.each([
    { name: "strong recent reviews, all checks pass", reviews: { averageRating: 4.8, recentCount: 9 }, checks: allScamChecksPass, score: 1 },
    { name: "no reviews", reviews: { averageRating: 0, recentCount: 0 }, checks: allScamChecksPass, score: 0 },
    { name: "mixed reviews", reviews: { averageRating: 3.5, recentCount: 20 }, checks: allScamChecksPass, score: 0 },
    { name: "a failed scam check", reviews: { averageRating: 5, recentCount: 20 }, checks: { ...allScamChecksPass, overseas_landlord: "fail" as const }, score: 0 },
    { name: "4.0 stars, 5 reviews", reviews: { averageRating: 4, recentCount: 5 }, checks: allScamChecksPass, score: 0.5 },
  ])("reviews and trust: $name", ({ reviews, checks, score }) => {
    expect(reviewsTrustScore(L({ reviews: f(reviews), scamChecks: f(checks, "me") })).score).toBeCloseTo(score, 12);
  });

  it.each([
    { name: "exact term", over: {}, score: 1 },
    { name: "12-month, sublet clause", over: { leaseMonths: f(12), exitClause: f("sublet" as const) }, score: 0.5 },
    { name: "12-month, paid break", over: { leaseMonths: f(12), exitClause: f("break" as const), breakFeeCents: f(100000) }, score: 0 },
    { name: "12-month, break fee Unknown", over: { leaseMonths: f(12), exitClause: f("break" as const) }, score: null },
  ])("lease fit: $name", ({ over, score }) => {
    expect(leaseFitScore(L(over), settings).score).toBe(score);
  });
});

describe("budget headroom and the transit-fits bonus", () => {
  // Caltrain 1 zone ($96) and 2 zones ($150) from the Bay Area pack.
  const oneZone = f({ legs: [{ mode: "transit" as const, agency: "caltrain", from: "Mountain View", to: "Palo Alto" }] }, "api");
  const twoZones = f({ legs: [{ mode: "transit" as const, agency: "caltrain", from: "Redwood City", to: "Palo Alto" }] }, "api");
  it.each([
    { name: "fits with pass ($2,404 + $96)", rent: 240400, route: oneZone, score: 1 },
    { name: "fits with room to spare", rent: 180000, route: twoZones, score: 1 },
    { name: "housing fits, pass does not ($2,450 + $96)", rent: 245000, route: oneZone, score: 5000 / 9600 },
    { name: "housing fits, 2-zone pass does not ($2,400 + $150)", rent: 240000, route: twoZones, score: 10000 / 15000 },
    { name: "housing exactly $2,500", rent: 250000, route: oneZone, score: 0 },
  ])("$name", ({ rent, route, score }) => {
    const listing = L({ rentCents: f(rent), commuteRoute: route });
    const cost = computeCost(listing, settings, bayAreaPack);
    expect(budgetHeadroomScore(cost, settings).score).toBeCloseTo(score, 12);
  });

  it("the bonus ranks a listing whose housing plus pass fits above one that only fits on housing", () => {
    const score = (rent: number) => {
      const listing = L({ rentCents: f(rent) });
      return scoreListing(listing, settings, computeCost(listing, settings, bayAreaPack), equalWeights).score;
    };
    expect(score(240400) - score(245000)).toBeCloseTo(12.5 * (1 - 5000 / 9600), 9);
  });

  it("is Unknown when the transit pass is Unknown and housing is under the cap", () => {
    const cost = computeCost(L({ commuteRoute: null }), settings, bayAreaPack);
    expect(budgetHeadroomScore(cost, settings).score).toBeNull();
  });
});

describe("weighted score", () => {
  it("scores the clean listing from the curves with equal weights", () => {
    const listing = L();
    const result = scoreListing(listing, settings, computeCost(listing, settings, bayAreaPack), equalWeights);
    const byFactor = Object.fromEntries(result.factors.map((x) => [x.factor, x.score]));
    expect(byFactor).toEqual({
      commute: 10 / 15,
      transit_quality: 1,
      budget_headroom: 1,
      grocery: 0.8,
      gym: 0.65,
      cafes: 1,
      reviews_trust: 1,
      lease_fit: 1,
    });
    expect(result.score).toBeCloseTo(12.5 * (10 / 15 + 1 + 1 + 0.8 + 0.65 + 1 + 1 + 1), 9);
    expect(result.knownWeight).toBeCloseTo(1, 12);
  });

  it("normalizes weights that do not sum to 1", () => {
    const doubled = Object.fromEntries(Object.entries(equalWeights).map(([k, v]) => [k, v * 2])) as Weights;
    const listing = L();
    const cost = computeCost(listing, settings, bayAreaPack);
    expect(scoreListing(listing, settings, cost, doubled).score).toBeCloseTo(scoreListing(listing, settings, cost, equalWeights).score, 9);
  });

  it("an Unknown factor earns nothing and lowers knownWeight", () => {
    const listing = L({ gymWalkMinutes: null });
    const result = scoreListing(listing, settings, computeCost(listing, settings, bayAreaPack), equalWeights);
    expect(result.factors.find((x) => x.factor === "gym")).toMatchObject({ score: null, points: null });
    expect(result.knownWeight).toBeCloseTo(0.875, 12);
  });

  it.each([
    { name: "all zero gives equal weights", input: { ...equalWeights, commute: 0, transit_quality: 0, budget_headroom: 0, grocery: 0, gym: 0, cafes: 0, reviews_trust: 0, lease_fit: 0 }, commute: 0.125 },
    { name: "negative counts as zero", input: { ...equalWeights, commute: -1 }, commute: 0 },
  ])("normalizeWeights: $name", ({ input, commute }) => {
    const out = normalizeWeights(input);
    expect(out.commute).toBeCloseTo(commute, 12);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});

describe("explain", () => {
  const breakdown = (scores: Partial<Record<keyof Weights, number | null>>, weights: Weights = equalWeights): ScoreBreakdown => {
    const normalized = normalizeWeights(weights);
    const factors = (Object.keys(equalWeights) as (keyof Weights)[]).map((factor) => {
      const score = factor in scores ? (scores[factor] ?? null) : 0.5;
      return { factor, label: factor, weight: normalized[factor], score, points: score === null ? null : normalized[factor] * score * 100, basis: "" };
    });
    return { score: 0, knownWeight: 1, factors };
  };

  it.each([
    {
      name: "highest earned are strengths, lowest score is the weakness",
      scores: { commute: 0.9, transit_quality: 1, gym: 0.1 },
      weights: equalWeights,
      strengths: ["transit_quality", "commute"],
      weakness: "gym",
    },
    {
      name: "weight decides: a heavily weighted 0.6 beats a lightly weighted 1.0",
      // Normalized: commute 0.385, cafes 0.038, others 0.096. Commute earns 30.8 points; cafes 3.8.
      scores: { commute: 0.8, cafes: 1, grocery: 0 },
      weights: { ...equalWeights, commute: 0.5, cafes: 0.05 },
      strengths: ["commute", "transit_quality"],
      weakness: "grocery",
    },
    {
      name: "ties break by factor order",
      scores: { commute: 1, transit_quality: 1, budget_headroom: 1, gym: 0 },
      weights: equalWeights,
      strengths: ["commute", "transit_quality"],
      weakness: "gym",
    },
  ])("$name", ({ scores, weights, strengths, weakness }) => {
    const result = explain(breakdown(scores, weights));
    expect(result.weakness?.factor).toBe(weakness);
    expect(result.strengths.map((s) => s.factor)).toEqual(strengths);
  });

  it("never picks an Unknown factor and lists it", () => {
    const result = explain(breakdown({ gym: null, commute: 1, transit_quality: 1 }));
    expect(result.unknown).toEqual(["gym"]);
    expect(result.weakness?.factor).not.toBe("gym");
  });

  it("has no weakness when every known factor is perfect", () => {
    const perfect = Object.fromEntries(Object.keys(equalWeights).map((k) => [k, 1]));
    const result = explain(breakdown(perfect));
    expect(result.weakness).toBeNull();
    expect(result.strengths.map((s) => s.factor)).toEqual(["commute", "transit_quality"]);
  });

  it("explains the clean listing from its real breakdown", () => {
    const listing = L();
    const result = explain(scoreListing(listing, settings, computeCost(listing, settings, bayAreaPack), equalWeights));
    // gym loses 0.35 * 12.5 points, more than commute's 0.333 * 12.5.
    expect(result.weakness?.factor).toBe("gym");
    expect(result.strengths.map((s) => s.factor)).toEqual(["transit_quality", "budget_headroom"]);
  });
});
