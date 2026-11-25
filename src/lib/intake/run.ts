// Run the automatic channels: SUPost, Gmail alerts and RentCast. Each run collects raw listings
// through its adapter, sends them through the pipeline, and records one channel_runs row.
// The daily cron route and `npm run intake:once` both call runAutomaticChannels.

import { createGmail, createRentcast, createSupost } from "@/lib/providers";
import { collectGmail } from "./channels/gmail";
import { collectRentcast } from "./channels/rentcast";
import { collectSupost } from "./channels/supost";
import type { Collected } from "./channels/types";
import { getOffice, processRaw, type IntakeDeps } from "./pipeline";
import { lastSuccessfulRun, recordChannelRun } from "./store";
import type { IntakeOutcome, RawListing } from "./types";

export type AutomaticChannel = "supost" | "gmail_alerts" | "rentcast";

export type ChannelSummary = {
  channel: AutomaticChannel;
  skipped: string | null;
  error: string | null;
  warnings: string[];
  seen: number;
  newCount: number;
  /** Posts left for the next run because the per-run limit was reached. */
  deferred: number;
  outcomes: IntakeOutcome[];
};

export type Clients = {
  supost: Pick<ReturnType<typeof createSupost>, "listings">;
  gmail: Pick<ReturnType<typeof createGmail>, "listMessages" | "getMessage">;
  rentcast: Pick<ReturnType<typeof createRentcast>, "listings">;
};

/**
 * What one run may spend, so a hosted function never reaches its time limit halfway through a post.
 * All times count from the start of the run.
 */
export type RunBudget = {
  /** The most posts that may need real work (a model call), added up across every channel. */
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

/** A budget with its clock started. `used` is shared by every channel in the run. */
type ActiveBudget = RunBudget & { startedAt: number; clock: () => number; used: number };

export type RunOptions = {
  channels?: AutomaticChannel[];
  /** Spend limits for hosted runs. Without it only `limit` applies. */
  budget?: RunBudget;
  /** Clock for the budget, in epoch ms. Tests replace it. */
  clock?: () => number;
  /** The most posts that may need real work (a model call) per channel. Already-seen ones are free. */
  limit?: number;
  /** Run RentCast even if it ran in the last 6 days. */
  force?: boolean;
  clients?: Partial<Clients>;
};

const DAY = 24 * 60 * 60_000;
const RENTCAST_EVERY_DAYS = 6;
const GMAIL_FIRST_RUN_DAYS = 3;
/** Re-read a day of mail each run, so messages deferred by a limit are picked up next time. */
const GMAIL_OVERLAP_DAYS = 1;
export const DEFAULT_LIMIT = 60;

function exhausted(budget: ActiveBudget | undefined): boolean {
  return budget !== undefined && (budget.used >= budget.maxWork || budget.clock() - budget.startedAt >= budget.startWithinMs);
}

/** Run one post, but give up on it when the budget's hard stop arrives. The post's own work may still finish later. */
async function processWithin(deps: IntakeDeps, raw: RawListing, budget: ActiveBudget | undefined): Promise<IntakeOutcome> {
  if (!budget) return processRaw(deps, raw);
  const left = budget.startedAt + budget.stopWithinMs - budget.clock();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<IntakeOutcome>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          status: "error",
          source: raw.source,
          url: raw.url ?? null,
          listingId: null,
          type: null,
          bucket: null,
          allInMonthlyCents: null,
          commuteMinutes: null,
          score: null,
          note: "gave up: the run reached its time limit",
        }),
      Math.max(0, left),
    );
  });
  try {
    return await Promise.race([processRaw(deps, raw), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

export async function processBatch(
  deps: IntakeDeps,
  items: RawListing[],
  limit: number,
  budget?: ActiveBudget,
): Promise<{ outcomes: IntakeOutcome[]; deferred: number }> {
  const outcomes: IntakeOutcome[] = [];
  let work = 0;
  for (const [index, raw] of items.entries()) {
    if (work >= limit || exhausted(budget)) return { outcomes, deferred: items.length - index };
    const outcome = await processWithin(deps, raw, budget);
    outcomes.push(outcome);
    if (outcome.status !== "already_seen") {
      work += 1;
      if (budget) budget.used += 1;
    }
    // A post that hit the hard stop leaves no time for another one.
    if (budget && outcome.status === "error" && outcome.note?.startsWith("gave up")) {
      return { outcomes, deferred: items.length - index - 1 };
    }
  }
  return { outcomes, deferred: 0 };
}

async function finish(
  deps: IntakeDeps,
  channel: AutomaticChannel,
  collected: Collected,
  limit: number,
  budget?: ActiveBudget,
): Promise<ChannelSummary> {
  if (collected.skipped) {
    return { channel, skipped: collected.skipped, error: null, warnings: [], seen: 0, newCount: 0, deferred: 0, outcomes: [] };
  }
  const { outcomes, deferred } = collected.error ? { outcomes: [], deferred: 0 } : await processBatch(deps, collected.items, limit, budget);
  const newCount = outcomes.filter((o) => o.status === "stored" || o.status === "roommate_lead").length;
  // A deferred run is recorded with a note, so it does not count as a clean success.
  const error = collected.error ?? (deferred > 0 ? `${deferred} posts deferred to the next run` : null);
  await recordChannelRun(deps.db, { channel, itemsSeen: collected.items.length, itemsNew: newCount, error }, deps.now().toISOString());
  return {
    channel,
    skipped: null,
    error,
    warnings: collected.warnings ?? [],
    seen: collected.items.length,
    newCount,
    deferred,
    outcomes,
  };
}

export async function runAutomaticChannels(deps: IntakeDeps, options: RunOptions = {}): Promise<ChannelSummary[]> {
  const wanted = options.channels ?? ["supost", "gmail_alerts", "rentcast"];
  const limit = options.limit ?? DEFAULT_LIMIT;
  const clock = options.clock ?? Date.now;
  const budget: ActiveBudget | undefined = options.budget && { ...options.budget, startedAt: clock(), clock, used: 0 };
  const clients: Clients = {
    supost: options.clients?.supost ?? createSupost(),
    gmail: options.clients?.gmail ?? createGmail(),
    rentcast: options.clients?.rentcast ?? createRentcast(),
  };
  const now = deps.now();
  const summaries: ChannelSummary[] = [];

  /** A channel that cannot start in time is skipped without a channel_runs row, so it counts as not yet run. */
  const outOfTime = (channel: AutomaticChannel): ChannelSummary | null =>
    exhausted(budget)
      ? { channel, skipped: "the run's time or post budget was used up", error: null, warnings: [], seen: 0, newCount: 0, deferred: 0, outcomes: [] }
      : null;

  if (wanted.includes("supost")) {
    summaries.push(outOfTime("supost") ?? (await finish(deps, "supost", await collectSupost(clients.supost, deps.settings), limit, budget)));
  }
  if (wanted.includes("gmail_alerts")) {
    const skipped = outOfTime("gmail_alerts");
    if (skipped) {
      summaries.push(skipped);
    } else {
      const last = await lastSuccessfulRun(deps.db, "gmail_alerts");
      const since = last
        ? new Date(Date.parse(last) - GMAIL_OVERLAP_DAYS * DAY).toISOString()
        : new Date(now.getTime() - GMAIL_FIRST_RUN_DAYS * DAY).toISOString();
      summaries.push(await finish(deps, "gmail_alerts", await collectGmail(clients.gmail, since), limit, budget));
    }
  }
  if (wanted.includes("rentcast")) {
    const skipped = outOfTime("rentcast");
    if (skipped) {
      summaries.push(skipped);
    } else {
      const last = await lastSuccessfulRun(deps.db, "rentcast");
      const recent = last !== null && now.getTime() - Date.parse(last) < RENTCAST_EVERY_DAYS * DAY;
      summaries.push(
        recent && !options.force
          ? await finish(deps, "rentcast", { items: [], error: null, skipped: `ran within the last ${RENTCAST_EVERY_DAYS} days` }, limit, budget)
          : await finish(deps, "rentcast", await collectRentcast(clients.rentcast, await getOffice(deps)), limit, budget),
      );
    }
  }
  return summaries;
}
