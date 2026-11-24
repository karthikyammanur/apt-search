// Roommate leads and channel health for the Leads and sources screen.

import { desc, eq } from "drizzle-orm";
import { CHANNELS, channelRuns, LEAD_STATUSES, roommateLeads } from "@/db/schema";
import { dbOf, type QueryOptions } from "./shared";

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type Channel = (typeof CHANNELS)[number];

export type RoommateLead = {
  id: number;
  source: string;
  postUrl: string | null;
  posterName: string | null;
  posterProfileUrl: string | null;
  groupName: string | null;
  text: string | null;
  datesWanted: string | null;
  /** Integer cents. Null when the post names no budget. */
  budgetCents: number | null;
  status: LeadStatus;
  notes: string | null;
  createdAt: string;
};

/** Every roommate lead, newest first. */
export async function getLeads(options?: QueryOptions): Promise<RoommateLead[]> {
  const db = dbOf(options);
  return db.select().from(roommateLeads).orderBy(desc(roommateLeads.createdAt), desc(roommateLeads.id));
}

export type SourceStatus = {
  channel: Channel;
  /** Null when the channel has never run. */
  lastRunAt: string | null;
  lastOkAt: string | null;
  /** The last run's error, or null when it succeeded (or never ran). */
  lastError: string | null;
  lastItemsSeen: number | null;
  lastItemsNew: number | null;
  /** New items over the 24 hours before `now`, across all runs. */
  newLast24h: number;
  runsLast24h: number;
};

export type GroupCapture = { groupName: string; lastCapturedAt: string; itemsNew: number };

export type SourceRuns = { channels: SourceStatus[]; facebookGroups: GroupCapture[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/** One status line per channel (in CHANNELS order), plus when each Facebook group was last captured. */
export async function getSourceRuns(options?: QueryOptions): Promise<SourceRuns> {
  const db = dbOf(options);
  const now = (options?.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const runs = await db.select().from(channelRuns).orderBy(desc(channelRuns.ranAt), desc(channelRuns.id));

  const channels = CHANNELS.map((channel): SourceStatus => {
    const mine = runs.filter((run) => run.channel === channel);
    const last = mine[0];
    const recent = mine.filter((run) => run.ranAt >= since);
    return {
      channel,
      lastRunAt: last?.ranAt ?? null,
      lastOkAt: mine.find((run) => run.error === null)?.ranAt ?? null,
      lastError: last?.error ?? null,
      lastItemsSeen: last?.itemsSeen ?? null,
      lastItemsNew: last?.itemsNew ?? null,
      newLast24h: recent.reduce((sum, run) => sum + run.itemsNew, 0),
      runsLast24h: recent.length,
    };
  });

  const groups = new Map<string, GroupCapture>();
  for (const run of runs) {
    if (run.channel !== "facebook_capture" || !run.groupName || run.error !== null) continue;
    if (!groups.has(run.groupName)) groups.set(run.groupName, { groupName: run.groupName, lastCapturedAt: run.ranAt, itemsNew: run.itemsNew });
  }
  return { channels, facebookGroups: [...groups.values()] };
}

export type WriteResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Move a roommate lead along (new, messaged, talking, not_a_fit), optionally with a note. */
export async function updateRoommateLeadStatus(
  input: { id: number; status: LeadStatus; notes?: string | null },
  options?: QueryOptions,
): Promise<WriteResult<RoommateLead>> {
  if (!(LEAD_STATUSES as readonly string[]).includes(input.status)) return { ok: false, error: "unknown status" };
  const db = dbOf(options);
  const [row] = await db
    .update(roommateLeads)
    .set({ status: input.status, ...(input.notes !== undefined ? { notes: input.notes } : {}) })
    .where(eq(roommateLeads.id, input.id))
    .returning();
  return row ? { ok: true, data: row } : { ok: false, error: "no such lead" };
}
