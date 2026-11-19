// Starting values the seed writes. The soft factors are the eight rows of the table in
// docs/design.md "Scoring and ranking". Weights start equal and later change through feedback.

export const SOFT_FACTORS = [
  "commute",
  "transit_quality",
  "budget_headroom",
  "grocery",
  "gym",
  "cafes",
  "reviews_trust",
  "lease_fit",
] as const;

export type SoftFactor = (typeof SOFT_FACTORS)[number];

export const STARTING_WEIGHT = 1 / SOFT_FACTORS.length;
