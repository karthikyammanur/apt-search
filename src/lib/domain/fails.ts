// How failed listings are grouped on the board: the reason in a few words, the near misses that
// fail only on budget, and the "N hidden: reason" summary. Pure functions, no I/O.

import type { FilterId } from "./filters";
import { fmtDollars } from "./format";

/** A listing that fails only on budget, and by no more than this, is a near miss. */
export const NEAR_MISS_CENTS = 15000;

/** Each failed requirement in a few words, for the hidden-fails summary. */
export const FAIL_LABELS: Record<FilterId, string> = {
  budget: "over budget",
  move_in: "wrong move-in dates",
  lease: "lease does not fit",
  commute: "too far from work",
  transit_access: "poor transit access",
  private_bed_bath: "no private bedroom and bath",
  furnished: "not furnished",
  scam_checks: "scam checks failed",
  roommates: "roommate concerns",
};

/**
 * How far over the cap the monthly cost is, in cents, or null when it is not over or not known.
 * The all-in total is used when it is known, else the confirmed costs alone (a floor).
 */
export function overBudgetCents(
  cost: { allInMonthlyCents: number | null; confirmedFloorCents: number },
  capCents: number,
): number | null {
  const total = cost.allInMonthlyCents ?? cost.confirmedFloorCents;
  return total > capCents ? total - capCents : null;
}

export type FailInfo = {
  /** Every filter that failed, in the order the filters run. */
  failedFilters: readonly FilterId[];
  /** Set when the budget filter failed. */
  overBudgetCents: number | null;
};

/** True when budget is the only failed requirement and the listing is no more than $150 over. */
export function isNearMiss(item: FailInfo): boolean {
  return (
    item.failedFilters.length === 1 &&
    item.failedFilters[0] === "budget" &&
    item.overBudgetCents !== null &&
    item.overBudgetCents <= NEAR_MISS_CENTS
  );
}

/** "$80 over" for a row. */
export const overLabel = (cents: number): string => `${fmtDollars(cents)} over`;

/** Near misses first-class: nearest to the cap first. The rest keep their order. */
export function splitFails<T extends FailInfo>(items: readonly T[]): { nearMisses: T[]; others: T[] } {
  const nearMisses = items
    .filter(isNearMiss)
    .sort((a, b) => (a.overBudgetCents ?? 0) - (b.overBudgetCents ?? 0));
  return { nearMisses, others: items.filter((item) => !isNearMiss(item)) };
}

/**
 * "4 hidden: over budget", or "5 hidden: 3 over budget, 2 wrong move-in dates". Each listing counts
 * under the first requirement it fails. Null when nothing is hidden.
 */
export function hiddenSummary(items: readonly Pick<FailInfo, "failedFilters">[]): string | null {
  if (items.length === 0) return null;
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = item.failedFilters[0] ? FAIL_LABELS[item.failedFilters[0]] : "requirements not met";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].sort((a, b) => b[1] - a[1]);
  const detail = parts.length === 1 ? parts[0]![0] : parts.map(([label, n]) => `${n} ${label}`).join(", ");
  return `${items.length} hidden: ${detail}`;
}
