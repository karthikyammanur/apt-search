// What one hosted run may spend, so a function never reaches its platform time limit halfway through
// a post. Shared by the daily cron run and the extension's capture route.

import { processRaw, type IntakeDeps } from "./pipeline";
import type { IntakeOutcome, RawListing } from "./types";

/** All times count from the start of the run. */
export type RunBudget = {
  /** The most posts that may need real work (a model call), added up across everything the run does. */
  maxWork: number;
  /** After this long no new post is started, and a channel that has not begun is skipped. */
  startWithinMs: number;
  /** After this long an unfinished post is given up on, so the run can still record itself and answer. */
  stopWithinMs: number;
};

/**
 * The daily cron run on Vercel Hobby, whose functions are cut off at 300 s (see docs/deploy.md).
 * A post takes about 10 to 20 s (one model call, then geocode, commute and places). The worst case is
 * longer, so the last post may start at 150 s and is abandoned at 270 s, leaving 30 s to record the
 * run. The 12-post total and 6-per-channel cap keep a typical run near 3 minutes, and keep one busy
 * channel from starving the others. Whatever is deferred is picked up by the next daily run.
 */
export const CRON_BUDGET: RunBudget & { perChannel: number } = {
  maxWork: 12,
  perChannel: 6,
  startWithinMs: 150_000,
  stopWithinMs: 270_000,
};

/**
 * One click of the extension: a page, or up to 50 Facebook posts. The same time limits as the cron
 * run, since the capture route has the same 300 s limit. Posts that do not fit are saved as pending
 * and the next cron run finishes them.
 */
export const CAPTURE_BUDGET: RunBudget = {
  maxWork: 50,
  startWithinMs: 150_000,
  stopWithinMs: 270_000,
};

/** A budget with its clock started. `used` is shared by everything in the run. */
export type ActiveBudget = RunBudget & { startedAt: number; clock: () => number; used: number };

export function startBudget(budget: RunBudget, clock: () => number = Date.now): ActiveBudget {
  return { ...budget, startedAt: clock(), clock, used: 0 };
}

export function exhausted(budget: ActiveBudget | undefined): boolean {
  return budget !== undefined && (budget.used >= budget.maxWork || budget.clock() - budget.startedAt >= budget.startWithinMs);
}

/** Marks a post that was abandoned at the hard stop. */
const GAVE_UP = Symbol("gave up");

/** Run one post, but give up on it when the budget's hard stop arrives. The post's own work may still finish later. */
async function processWithin(deps: IntakeDeps, raw: RawListing, budget: ActiveBudget | undefined): Promise<IntakeOutcome | typeof GAVE_UP> {
  if (!budget) return processRaw(deps, raw);
  const left = budget.startedAt + budget.stopWithinMs - budget.clock();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof GAVE_UP>((resolve) => {
    timer = setTimeout(() => resolve(GAVE_UP), Math.max(0, left));
  });
  try {
    return await Promise.race([processRaw(deps, raw), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type BatchResult = {
  /** One outcome per post that finished, in order. */
  outcomes: IntakeOutcome[];
  /** How many posts were not finished (not started, or given up on). Zero means all done. */
  deferred: number;
  /** Those posts themselves, in order, so a caller can keep them for later. */
  leftover: RawListing[];
  /** True when a post was started and then abandoned at the hard stop. */
  gaveUp: boolean;
};

/**
 * Process posts one at a time. Stops when `limit` posts needed real work, when the budget says so, or
 * when a post outlasts the hard stop. Posts already seen cost almost nothing and do not count.
 */
export async function processBatch(
  deps: IntakeDeps,
  items: RawListing[],
  limit: number,
  budget?: ActiveBudget,
): Promise<BatchResult> {
  const outcomes: IntakeOutcome[] = [];
  let work = 0;
  for (const [index, raw] of items.entries()) {
    if (work >= limit || exhausted(budget)) {
      return { outcomes, deferred: items.length - index, leftover: items.slice(index), gaveUp: false };
    }
    const outcome = await processWithin(deps, raw, budget);
    // A post that hit the hard stop leaves no time for another one.
    if (outcome === GAVE_UP) return { outcomes, deferred: items.length - index, leftover: items.slice(index), gaveUp: true };
    outcomes.push(outcome);
    if (outcome.status !== "already_seen") {
      work += 1;
      if (budget) budget.used += 1;
    }
  }
  return { outcomes, deferred: 0, leftover: [], gaveUp: false };
}
