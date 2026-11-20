// Card explanations from the score breakdown: the top two strengths and the biggest weakness.
// Strength = points earned (weight * score). Weakness = points lost (weight * (1 - score)).
// Unknown factors are listed separately and never picked. Ties go to the earlier factor in
// SOFT_FACTORS order, so the result is stable.

import type { FactorScore, ScoreBreakdown } from "./score";
import type { SoftFactor } from "./types";

export type ExplainItem = {
  factor: SoftFactor;
  label: string;
  score: number;
  weight: number;
  /** Points earned (strength) or lost (weakness), out of 100. */
  points: number;
  basis: string;
};

export type Explanation = {
  strengths: ExplainItem[];
  weakness: ExplainItem | null;
  unknown: SoftFactor[];
};

const EPS = 1e-12;

function item(factor: FactorScore & { score: number }, points: number): ExplainItem {
  return { factor: factor.factor, label: factor.label, score: factor.score, weight: factor.weight, points, basis: factor.basis };
}

export function explain(breakdown: ScoreBreakdown): Explanation {
  const known = breakdown.factors.filter((f): f is FactorScore & { score: number } => f.score !== null);
  const order = (a: { i: number; v: number }, b: { i: number; v: number }) =>
    Math.abs(b.v - a.v) > EPS ? b.v - a.v : a.i - b.i;

  const lost = known
    .map((f, i) => ({ f, i, v: f.weight * (1 - f.score) * 100 }))
    .filter((x) => x.v > EPS)
    .sort(order);
  const worst = lost[0];
  const weakness = worst ? item(worst.f, worst.v) : null;

  const strengths = known
    .map((f, i) => ({ f, i, v: f.weight * f.score * 100 }))
    .filter((x) => x.v > EPS && x.f.factor !== weakness?.factor)
    .sort(order)
    .slice(0, 2)
    .map((x) => item(x.f, x.v));

  return {
    strengths,
    weakness,
    unknown: breakdown.factors.filter((f) => f.score === null).map((f) => f.factor),
  };
}
