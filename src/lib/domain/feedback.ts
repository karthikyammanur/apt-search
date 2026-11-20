// Learning from feedback (docs/design.md "Scoring and ranking", stage 3). A reaction becomes a
// few structured weight changes. Each factor moves at most 0.1 per reaction, weights stay in
// 0..1, and the result is renormalized to sum to 1. The change log is built from the numbers.

import { z } from "zod";
import { SOFT_FACTORS } from "@/db/defaults";
import { fmtWeight } from "./format";
import { FACTOR_LABELS, normalizeWeights, type Weights } from "./score";
import type { SoftFactor } from "./types";

export const STEP_SIZES = { small: 0.05, medium: 0.1 } as const;
export const MAX_CHANGE_PER_REACTION = 0.1;

export const feedbackChangeSchema = z
  .object({
    factor: z.enum(SOFT_FACTORS),
    direction: z.enum(["up", "down"]),
    size: z.enum(["small", "medium"]),
  })
  .strict();
export type FeedbackChange = z.infer<typeof feedbackChangeSchema>;

export type WeightChange = { factor: SoftFactor; before: number; after: number };

export type FeedbackResult = {
  weights: Weights;
  changes: WeightChange[];
  /** Plain sentences, such as "Raised transit quality from 0.12 to 0.18". */
  log: string[];
};

const EPS = 1e-12;

export function applyFeedback(weights: Weights, changes: readonly FeedbackChange[]): FeedbackResult {
  const before = normalizeWeights(weights);
  const requested = new Map<SoftFactor, number>();
  for (const change of changes) {
    const step = STEP_SIZES[change.size] * (change.direction === "up" ? 1 : -1);
    requested.set(change.factor, (requested.get(change.factor) ?? 0) + step);
  }

  const raw = { ...before };
  const notes = new Map<SoftFactor, string>();
  for (const [factor, delta] of requested) {
    const capped = Math.max(-MAX_CHANGE_PER_REACTION, Math.min(MAX_CHANGE_PER_REACTION, delta));
    if (Math.abs(capped - delta) > EPS) notes.set(factor, "capped at 0.10 per reaction");
    const moved = before[factor] + capped;
    if (moved < 0) notes.set(factor, "a weight cannot go below 0");
    if (moved > 1) notes.set(factor, "a weight cannot go above 1");
    raw[factor] = Math.max(0, Math.min(1, moved));
  }

  const total = SOFT_FACTORS.reduce((sum, f) => sum + raw[f], 0);
  if (total <= EPS) {
    return { weights: before, changes: [], log: ["No change: that would set every weight to 0."] };
  }
  const after = normalizeWeights(raw);

  const log: string[] = [];
  const weightChanges: WeightChange[] = [];
  for (const factor of requested.keys()) {
    const from = before[factor];
    const to = after[factor];
    weightChanges.push({ factor, before: from, after: to });
    const label = FACTOR_LABELS[factor];
    const note = notes.get(factor);
    const suffix = note ? ` (${note})` : "";
    if (to > from + EPS) log.push(`Raised ${label} from ${fmtWeight(from)} to ${fmtWeight(to)}${suffix}`);
    else if (to < from - EPS) log.push(`Lowered ${label} from ${fmtWeight(from)} to ${fmtWeight(to)}${suffix}`);
    else log.push(`Kept ${label} at ${fmtWeight(from)}${suffix}`);
  }
  const othersMoved = SOFT_FACTORS.some((f) => !requested.has(f) && Math.abs(after[f] - before[f]) > EPS);
  if (othersMoved) log.push("Rescaled the other weights so all weights add up to 1.");

  return { weights: after, changes: weightChanges, log };
}
