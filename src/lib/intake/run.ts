// Run the automatic channels: SUPost, Gmail alerts and RentCast. Each run collects raw listings
// through its adapter, sends them through the pipeline, and records one channel_runs row.
// The daily cron route and `npm run intake:once` both call runAutomaticChannels. A full run starts by
// finishing posts the extension sent that the capture route had no time for (pending_captures).

import { createGmail, createRentcast, createSupost } from "@/lib/providers";
import { exhausted, processBatch, startBudget, type ActiveBudget, type RunBudget } from "./budget";
import { collectGmail } from "./channels/gmail";
import { collectRentcast } from "./channels/rentcast";
import { collectSupost } from "./channels/supost";
import type { Collected } from "./channels/types";
import { failPending, loadPending, recordCaptureRuns, removePending } from "./pending";
import { getOffice, type IntakeDeps } from "./pipeline";
import { lastSuccessfulRun, recordChannelRun } from "./store";
import type { IntakeOutcome } from "./types";

export { CAPTURE_BUDGET, CRON_BUDGET, processBatch, type RunBudget } from "./budget";

export type AutomaticChannel = "supost" | "gmail_alerts" | "rentcast";

export type ChannelSummary = {
  /** `pending_captures` is the extension's saved posts, finished before the channels. */
  channel: AutomaticChannel | "pending_captures";
  skipped: string | null;
  error: string | null;
  warnings: string[];
  seen: number;
  newCount: number;
  /** Posts left for the next run because the per-run limit or budget was reached. */
  deferred: number;
  outcomes: IntakeOutcome[];
};

export type Clients = {
  supost: Pick<ReturnType<typeof createSupost>, "listings">;
  gmail: Pick<ReturnType<typeof createGmail>, "listMessages" | "getMessage">;
  rentcast: Pick<ReturnType<typeof createRentcast>, "listings">;
};

export type RunOptions = {
  channels?: AutomaticChannel[];
  /** Finish the extension's saved posts first. On by default for a full run (no channel list). */
  pending?: boolean;
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
/** How many saved extension posts one run looks at. The budget decides how many it finishes. */
const PENDING_READ_LIMIT = 100;

/** What a deferral looks like in channel_runs. A deferred run does not count as a clean success. */
function deferredNote(deferred: number, gaveUp: boolean): string | null {
  if (deferred === 0) return null;
  return `${deferred} posts deferred to the next run${gaveUp ? " (one took too long)" : ""}`;
}

const emptySummary = (channel: ChannelSummary["channel"], skipped: string | null): ChannelSummary => ({
  channel,
  skipped,
  error: null,
  warnings: [],
  seen: 0,
  newCount: 0,
  deferred: 0,
  outcomes: [],
});

async function finish(
  deps: IntakeDeps,
  channel: AutomaticChannel,
  collected: Collected,
  limit: number,
  budget?: ActiveBudget,
): Promise<ChannelSummary> {
  if (collected.skipped) return emptySummary(channel, collected.skipped);
  const batch = collected.error ? null : await processBatch(deps, collected.items, limit, budget);
  const outcomes = batch?.outcomes ?? [];
  const deferred = batch?.deferred ?? 0;
  const newCount = outcomes.filter((o) => o.status === "stored" || o.status === "roommate_lead").length;
  const error = collected.error ?? deferredNote(deferred, batch?.gaveUp ?? false);
  await recordChannelRun(deps.db, { channel, itemsSeen: collected.items.length, itemsNew: newCount, error }, deps.now().toISOString());
  return { channel, skipped: null, error, warnings: collected.warnings ?? [], seen: collected.items.length, newCount, deferred, outcomes };
}

/**
 * Finish the posts the capture route saved for later. They come first: someone clicked Capture on
 * each of them. A post that errors is tried again on later runs, up to three times.
 */
async function finishPending(deps: IntakeDeps, limit: number, budget?: ActiveBudget): Promise<ChannelSummary | null> {
  const waiting = await loadPending(deps.db, PENDING_READ_LIMIT);
  if (waiting.length === 0) return null;
  const batch = await processBatch(deps, waiting.map((row) => row.raw), limit, budget);
  for (const [index, outcome] of batch.outcomes.entries()) {
    const row = waiting[index]!;
    if (outcome.status === "error") await failPending(deps.db, row);
    else await removePending(deps.db, row.id);
  }
  // A post abandoned at the hard stop is the next one in line. It counts as a failed try.
  if (batch.gaveUp) await failPending(deps.db, waiting[batch.outcomes.length]!);
  const now = deps.now().toISOString();
  await recordCaptureRuns(deps.db, waiting.slice(0, batch.outcomes.length).map((row) => row.raw), batch.outcomes, now);
  return {
    ...emptySummary("pending_captures", null),
    error: deferredNote(batch.deferred, batch.gaveUp),
    seen: waiting.length,
    newCount: batch.outcomes.filter((o) => o.status === "stored" || o.status === "roommate_lead").length,
    deferred: batch.deferred,
    outcomes: batch.outcomes,
  };
}

export async function runAutomaticChannels(deps: IntakeDeps, options: RunOptions = {}): Promise<ChannelSummary[]> {
  const wanted = options.channels ?? ["supost", "gmail_alerts", "rentcast"];
  const limit = options.limit ?? DEFAULT_LIMIT;
  const budget = options.budget && startBudget(options.budget, options.clock);
  const clients: Clients = {
    supost: options.clients?.supost ?? createSupost(),
    gmail: options.clients?.gmail ?? createGmail(),
    rentcast: options.clients?.rentcast ?? createRentcast(),
  };
  const now = deps.now();
  const summaries: ChannelSummary[] = [];

  if (options.pending ?? options.channels === undefined) {
    const pending = await finishPending(deps, limit, budget);
    if (pending) summaries.push(pending);
  }

  /** A channel that cannot start in time is skipped without a channel_runs row, so it counts as not yet run. */
  const outOfTime = (channel: AutomaticChannel): ChannelSummary | null =>
    exhausted(budget) ? emptySummary(channel, "the run's time or post budget was used up") : null;

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
