// The stay period: move-in to move-out, and its length in months (days / 30.4375).

import { daysBetween, dayNumber, laterDate } from "./dates";
import { ratFrac, ratToNumber, type Rat } from "./rational";
import type { ListingFacts, Settings } from "./types";

/** 30.4375 days per month (365.25 / 12), as the exact fraction 487 / 16. */
export const DAYS_PER_MONTH = { n: 487, d: 16 } as const;

export type Stay = {
  moveIn: string;
  moveOut: string;
  /** True when the listing's move-in date is Unknown and the latest allowed move-in was used. */
  moveInAssumed: boolean;
  /** Null when the dates are invalid or move-out is not after move-in. */
  days: number | null;
  /** Exact months of stay, days * 16 / 487. */
  months: Rat | null;
  /** Months of stay for display only. */
  monthsApprox: number | null;
};

/**
 * Move-in is the later of the listing's available date and my earliest move-in. When the
 * available date is Unknown, the latest move-in in my window is used: fewer months means a
 * higher monthly share of one-time costs, so the cap check errs on the safe side.
 */
export function stayPeriod(facts: ListingFacts, settings: Settings): Stay {
  const available = facts.availableFrom?.value;
  const known = available !== undefined && dayNumber(available) !== null;
  const moveIn = known ? laterDate(available, settings.moveInEarliest) : settings.moveInLatest;
  const days = daysBetween(moveIn, settings.moveOut);
  const valid = days !== null && days > 0;
  const months = valid ? ratFrac(days * DAYS_PER_MONTH.d, DAYS_PER_MONTH.n) : null;
  return {
    moveIn,
    moveOut: settings.moveOut,
    moveInAssumed: !known,
    days: valid ? days : null,
    months,
    monthsApprox: months ? ratToNumber(months) : null,
  };
}

/**
 * Fixed lease lengths that fit the stay: the stay in months rounded down to rounded up.
 * A stay of 7.33 months gives 7 to 8, matching "a 7 to 8 month lease" in the requirements.
 */
export function acceptableLeaseMonths(stay: Stay): { min: number; max: number } | null {
  if (stay.days === null) return null;
  const scaled = stay.days * DAYS_PER_MONTH.d;
  const min = (scaled - (scaled % DAYS_PER_MONTH.n)) / DAYS_PER_MONTH.n;
  const max = scaled % DAYS_PER_MONTH.n === 0 ? min : min + 1;
  return { min, max };
}
