// Soft score (docs/design.md "Scoring and ranking", stage 2). Each factor maps to 0..1 with a
// fixed curve, then a weighted sum with weights normalized to 1 gives 0..100.
//
// An Unknown factor keeps a null score and earns no points, so missing data never raises a
// listing's rank. `knownWeight` says how much of the weight rests on known facts.

import { SOFT_FACTORS } from "@/db/defaults";
import type { CostResult } from "./cost";
import { analyzeLease } from "./lease";
import { stayPeriod } from "./stay";
import { SCAM_CHECK_IDS, type ListingFacts, type Settings, type SoftFactor } from "./types";

export type Weights = Record<SoftFactor, number>;

export const FACTOR_LABELS: Record<SoftFactor, string> = {
  commute: "commute",
  transit_quality: "transit quality",
  budget_headroom: "budget headroom",
  grocery: "grocery",
  gym: "gym",
  cafes: "cafes",
  reviews_trust: "reviews and trust",
  lease_fit: "lease fit",
};

/** Curve endpoints from the design's scoring table, plus the reviews thresholds chosen here. */
export const CURVES = {
  commute: { full: 15, zero: 30 },
  stopWalk: { full: 5, zero: 10 },
  headway: { full: 15, zero: 30 },
  grocery: { full: 5, zero: 20 },
  gym: { full: 5, zero: 25 },
  cafes: { fullWithin: 10, zeroBeyond: 15, countForFull: 3 },
  rating: { full: 4.5, zero: 3.5 },
  recentReviewsForFull: 5,
} as const;

/** 1 at or below `full`, 0 at or above `zero`, a straight line between. */
export function linearDown(x: number, full: number, zero: number): number {
  if (x <= full) return 1;
  if (x >= zero) return 0;
  return (zero - x) / (zero - full);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Weights scaled to sum to 1. Negative or non-finite weights count as 0; all zero gives equal weights. */
export function normalizeWeights(weights: Weights): Weights {
  const safe = SOFT_FACTORS.map((f) => {
    const w = weights[f];
    return Number.isFinite(w) && w > 0 ? w : 0;
  });
  const total = safe.reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    SOFT_FACTORS.map((f, i) => [f, total > 0 ? (safe[i] ?? 0) / total : 1 / SOFT_FACTORS.length]),
  ) as Weights;
}

type FactorValue = { score: number | null; basis: string };

export function commuteScore(facts: ListingFacts): FactorValue {
  const m = facts.commuteMinutes?.value;
  if (m === undefined) return { score: null, basis: "Commute Unknown" };
  return { score: linearDown(m, CURVES.commute.full, CURVES.commute.zero), basis: `${m} min door to office` };
}

/** Best stop wins. A stop scores the average of its walk (5 to 10 min) and frequency (15 to 30 min; regional rail counts as frequent). */
export function transitQualityScore(facts: ListingFacts): FactorValue {
  const stops = facts.nearbyStops?.value;
  if (stops === undefined) return { score: null, basis: "Nearby stops Unknown" };
  if (stops.length === 0) return { score: 0, basis: "No stops nearby" };
  let best: { score: number; basis: string } | null = null;
  for (const stop of stops) {
    const walk = linearDown(stop.walkMinutes, CURVES.stopWalk.full, CURVES.stopWalk.zero);
    const freq = stop.regionalRail
      ? 1
      : stop.rushHeadwayMinutes === null
        ? null
        : linearDown(stop.rushHeadwayMinutes, CURVES.headway.full, CURVES.headway.zero);
    if (freq === null) continue;
    const score = (walk + freq) / 2;
    if (best === null || score > best.score) {
      const what = stop.regionalRail ? "rail station" : `stop every ${stop.rushHeadwayMinutes} min`;
      best = { score, basis: `${stop.name ?? what}, ${stop.walkMinutes} min walk` };
    }
  }
  return best ?? { score: null, basis: "Rush-hour frequency Unknown" };
}

/**
 * 1 when housing plus the transit pass fits under the cap; 0 when housing alone reaches the
 * cap; in between, the share of the pass that still fits: (cap - housing) / pass.
 */
export function budgetHeadroomScore(cost: CostResult, settings: Settings): FactorValue {
  const housing = cost.allInMonthlyCents;
  const cap = settings.budgetCapCents;
  if (housing === null) return { score: null, basis: "All-in cost Unknown" };
  if (housing >= cap) return { score: 0, basis: "Housing alone reaches the cap" };
  if (cost.transitPass.status === "unknown") return { score: null, basis: "Transit pass Unknown" };
  const pass = cost.transitPass.monthlyCents;
  if (housing + pass <= cap) return { score: 1, basis: "Housing plus transit pass fits under the cap" };
  return { score: clamp01((cap - housing) / pass), basis: "Housing fits, but housing plus transit pass is over the cap" };
}

export function groceryScore(facts: ListingFacts): FactorValue {
  const m = facts.groceryWalkMinutes?.value;
  if (m === undefined) return { score: null, basis: "Grocery Unknown" };
  return { score: linearDown(m, CURVES.grocery.full, CURVES.grocery.zero), basis: `Grocery ${m} min walk` };
}

export function gymScore(facts: ListingFacts): FactorValue {
  const m = facts.gymWalkMinutes?.value;
  if (m === undefined) return { score: null, basis: "Gym Unknown" };
  return { score: linearDown(m, CURVES.gym.full, CURVES.gym.zero), basis: `Gym ${m} min walk` };
}

/** Each cafe counts 1 within 10 min, sliding to 0 at 15 min; 3 counted cafes score 1. */
export function cafesScore(facts: ListingFacts): FactorValue {
  const walks = facts.cafeWalkMinutes?.value;
  if (walks === undefined) return { score: null, basis: "Cafes Unknown" };
  const credit = walks.reduce(
    (sum, m) => sum + linearDown(m, CURVES.cafes.fullWithin, CURVES.cafes.zeroBeyond),
    0,
  );
  const within = walks.filter((m) => m <= CURVES.cafes.fullWithin).length;
  return { score: clamp01(credit / CURVES.cafes.countForFull), basis: `${within} cafes within a 10 min walk` };
}

/**
 * Reviews part times scam part. Reviews: rating 3.5 to 4.5 times recent volume (5 reviews in 2
 * years for full); no reviews scores 0. Scam: share of checks passed or resolved; any fail is 0.
 */
export function reviewsTrustScore(facts: ListingFacts): FactorValue {
  const checks = facts.scamChecks?.value;
  if (checks && SCAM_CHECK_IDS.some((id) => checks[id] === "fail")) {
    return { score: 0, basis: "A scam check failed" };
  }
  const reviews = facts.reviews?.value;
  if (reviews === undefined || checks === undefined) return { score: null, basis: "Reviews or scam checks Unknown" };
  if (reviews.recentCount <= 0) return { score: 0, basis: "No recent reviews" };
  const rating = 1 - linearDown(reviews.averageRating, CURVES.rating.zero, CURVES.rating.full);
  const volume = clamp01(reviews.recentCount / CURVES.recentReviewsForFull);
  const passed = SCAM_CHECK_IDS.filter((id) => checks[id] === "pass" || checks[id] === "resolved").length;
  return {
    score: rating * volume * (passed / SCAM_CHECK_IDS.length),
    basis: `${reviews.averageRating} stars from ${reviews.recentCount} recent reviews; ${passed} of ${SCAM_CHECK_IDS.length} scam checks pass`,
  };
}

/** 1 for an exact fit, 0.5 when I must sublet or use a free break clause, 0 for a paid break or no fit. */
export function leaseFitScore(facts: ListingFacts, settings: Settings): FactorValue {
  const lease = analyzeLease(facts, settings, stayPeriod(facts, settings));
  if (lease.status === "unknown") return { score: null, basis: lease.reason };
  if (lease.status === "fail") return { score: 0, basis: lease.reason };
  if (lease.exit === "none_needed") return { score: 1, basis: lease.reason };
  if (lease.exit === "sublet_clause") return { score: 0.5, basis: lease.reason };
  const fee = facts.breakFeeCents?.value;
  if (fee === undefined) return { score: null, basis: "Break fee Unknown" };
  return fee > 0 ? { score: 0, basis: "Needs a paid lease break" } : { score: 0.5, basis: "Free break clause" };
}

export type FactorScore = {
  factor: SoftFactor;
  label: string;
  /** Normalized weight, 0..1. */
  weight: number;
  /** 0..1, or null when Unknown. */
  score: number | null;
  /** weight * score * 100. Null when Unknown. */
  points: number | null;
  basis: string;
};

export type ScoreBreakdown = {
  /** 0..100. Unknown factors add nothing. */
  score: number;
  /** Sum of the weights of known factors, 0..1. */
  knownWeight: number;
  factors: FactorScore[];
};

export function scoreListing(
  facts: ListingFacts,
  settings: Settings,
  cost: CostResult,
  weights: Weights,
): ScoreBreakdown {
  const values: Record<SoftFactor, FactorValue> = {
    commute: commuteScore(facts),
    transit_quality: transitQualityScore(facts),
    budget_headroom: budgetHeadroomScore(cost, settings),
    grocery: groceryScore(facts),
    gym: gymScore(facts),
    cafes: cafesScore(facts),
    reviews_trust: reviewsTrustScore(facts),
    lease_fit: leaseFitScore(facts, settings),
  };
  const normalized = normalizeWeights(weights);
  const factors = SOFT_FACTORS.map((factor): FactorScore => {
    const { score, basis } = values[factor];
    const weight = normalized[factor];
    return { factor, label: FACTOR_LABELS[factor], weight, score, points: score === null ? null : weight * score * 100, basis };
  });
  return {
    score: factors.reduce((sum, f) => sum + (f.points ?? 0), 0),
    knownWeight: factors.reduce((sum, f) => sum + (f.score === null ? 0 : f.weight), 0),
    factors,
  };
}
