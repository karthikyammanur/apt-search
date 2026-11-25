// Posts the extension sent that the capture route had no time to process. They wait in
// pending_captures and the next cron run finishes them with the same pipeline.
// Nothing here fetches anything: the stored post is data, and its links are never opened.

import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { CHANNELS, pendingCaptures } from "@/db/schema";
import type { Db } from "@/db";
import type { ChannelName, IntakeOutcome, RawListing } from "./types";
import { recordChannelRun } from "./store";

/** A run that keeps failing on a post gives up on it after this many tries. */
export const MAX_PENDING_ATTEMPTS = 3;

const text = z.string().max(30_000);
const link = z.string().max(2000);
/** Only the shapes the capture route creates. Read back through this, because the column is untyped JSON. */
const pendingRawSchema = z.object({
  channel: z.enum(["extension", "facebook_capture"]),
  source: z.string().max(300),
  url: link.nullable(),
  title: z.string().max(500).nullish(),
  text,
  photoUrls: z.array(link).max(30),
  photoHashes: z.array(z.string().max(200)).max(30),
  groupName: z.string().max(300).nullish(),
  posterName: z.string().max(300).nullish(),
  posterProfileUrl: link.nullish(),
});

export type PendingRow = { id: number; attempts: number; raw: RawListing };

/** Keep posts for later. A post already waiting (same url) is not queued twice. */
export async function savePending(db: Db, items: RawListing[], now: string): Promise<number> {
  let saved = 0;
  for (const raw of items) {
    if (!pendingRawSchema.safeParse(raw).success) continue;
    const rows = await db
      .insert(pendingCaptures)
      .values({ url: raw.url, raw, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: pendingCaptures.id });
    saved += rows.length;
  }
  return saved;
}

/** The oldest waiting posts. A row that no longer parses is dropped rather than retried forever. */
export async function loadPending(db: Db, limit: number): Promise<PendingRow[]> {
  const rows = await db.select().from(pendingCaptures).orderBy(asc(pendingCaptures.id)).limit(limit);
  const out: PendingRow[] = [];
  for (const row of rows) {
    const parsed = pendingRawSchema.safeParse(row.raw);
    if (parsed.success) out.push({ id: row.id, attempts: row.attempts, raw: parsed.data as RawListing });
    else await removePending(db, row.id);
  }
  return out;
}

export async function countPending(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(pendingCaptures);
  return Number(row?.n ?? 0);
}

export async function removePending(db: Db, id: number): Promise<void> {
  await db.delete(pendingCaptures).where(eq(pendingCaptures.id, id));
}

/** A try that failed: count it, and drop the post once it has failed too many times. */
export async function failPending(db: Db, row: PendingRow): Promise<void> {
  if (row.attempts + 1 >= MAX_PENDING_ATTEMPTS) await removePending(db, row.id);
  else await db.update(pendingCaptures).set({ attempts: row.attempts + 1 }).where(eq(pendingCaptures.id, row.id));
}

/**
 * One channel_runs row per group for a batch of captured posts, so "last captured" is per group.
 * Facebook batches carry a group name; a single page does not.
 */
export async function recordCaptureRuns(
  db: Db,
  items: RawListing[],
  outcomes: IntakeOutcome[],
  now: string,
  note: string | null = null,
): Promise<void> {
  const groups = new Map<string, { channel: ChannelName; group: string | null; outcomes: IntakeOutcome[] }>();
  for (const [index, outcome] of outcomes.entries()) {
    const raw = items[index];
    const channel = raw && CHANNELS.includes(raw.channel as ChannelName) ? (raw.channel as ChannelName) : "extension";
    const group = raw?.groupName ?? null;
    const key = `${channel}\u0000${group ?? ""}`;
    const entry = groups.get(key) ?? { channel, group, outcomes: [] };
    entry.outcomes.push(outcome);
    groups.set(key, entry);
  }
  for (const { channel, group, outcomes: list } of groups.values()) {
    await recordChannelRun(
      db,
      {
        channel,
        groupName: group,
        itemsSeen: list.length,
        itemsNew: list.filter((o) => o.status === "stored" || o.status === "roommate_lead").length,
        error: list.some((o) => o.status === "error") ? "some posts failed" : note,
      },
      now,
    );
  }
}
