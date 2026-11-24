// Chat history and feedback events for step 6. A feedback event stores the full weights before
// and after, so the change can be shown ("Raised transit quality from 0.12 to 0.18") and undone.
// The weights themselves come from applyFeedback in the domain; this file only stores them.

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { SOFT_FACTORS } from "@/db/defaults";
import { CHAT_ROLES, chatMessages, feedbackEvents, listings } from "@/db/schema";
import type { Weights } from "@/lib/domain";
import { loadWeights } from "@/lib/intake/store";
import type { WriteResult } from "./leads";
import { recheckAllListings, writeWeights } from "./settings";
import { dbOf, type QueryOptions } from "./shared";

export type ChatRole = (typeof CHAT_ROLES)[number];
export type StoredChatMessage = { id: number; role: ChatRole; content: unknown; createdAt: string };

export async function saveChatMessage(
  input: { role: ChatRole; content: unknown },
  options?: QueryOptions,
): Promise<number> {
  const db = dbOf(options);
  const createdAt = (options?.now ?? (() => new Date()))().toISOString();
  const [row] = await db
    .insert(chatMessages)
    .values({ role: input.role, content: input.content ?? null, createdAt })
    .returning({ id: chatMessages.id });
  if (!row) throw new Error("Chat message insert returned no row");
  return row.id;
}

/** The latest messages, oldest first (default 50). */
export async function getChatMessages(input: { limit?: number } = {}, options?: QueryOptions): Promise<StoredChatMessage[]> {
  const db = dbOf(options);
  const rows = await db
    .select()
    .from(chatMessages)
    .orderBy(desc(chatMessages.id))
    .limit(input.limit ?? 50);
  return rows.reverse();
}

export type FeedbackEvent = {
  id: number;
  listingId: number | null;
  reason: string;
  weightsBefore: Weights;
  weightsAfter: Weights;
  createdAt: string;
  undoneAt: string | null;
};

function isWeights(value: unknown): value is Weights {
  return (
    typeof value === "object" &&
    value !== null &&
    SOFT_FACTORS.every((f) => typeof (value as Record<string, unknown>)[f] === "number")
  );
}

function toEvent(row: typeof feedbackEvents.$inferSelect): FeedbackEvent {
  return {
    id: row.id,
    listingId: row.listingId,
    reason: row.reason,
    weightsBefore: row.weightsBefore as Weights,
    weightsAfter: row.weightsAfter as Weights,
    createdAt: row.createdAt,
    undoneAt: row.undoneAt,
  };
}

/**
 * Save a reaction and apply its new weights (from applyFeedback), then recheck every listing so
 * scores reflect them. `weightsBefore` is read from the database, not trusted from the caller.
 */
export async function saveFeedbackEvent(
  input: { listingId?: number | null; reason: string; weightsAfter: Weights },
  options?: QueryOptions,
): Promise<WriteResult<FeedbackEvent>> {
  if (!input.reason.trim()) return { ok: false, error: "a reason is required" };
  if (!isWeights(input.weightsAfter)) return { ok: false, error: "weights must name every factor" };
  const db = dbOf(options);
  if (input.listingId !== undefined && input.listingId !== null) {
    const [listing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, input.listingId));
    if (!listing) return { ok: false, error: "no such listing" };
  }
  const at = (options?.now ?? (() => new Date()))().toISOString();
  const weightsBefore = await loadWeights(db);
  const [row] = await db
    .insert(feedbackEvents)
    .values({
      listingId: input.listingId ?? null,
      reason: input.reason.trim(),
      weightsBefore,
      weightsAfter: input.weightsAfter,
      createdAt: at,
    })
    .returning();
  if (!row) return { ok: false, error: "insert returned no row" };
  await writeWeights(input.weightsAfter, "chat", { at, eventId: row.id }, options);
  await recheckAllListings(options);
  return { ok: true, data: toEvent(row) };
}

/** Undo the latest event that is not undone yet: restore its weights before. Null when none. */
export async function undoLastFeedbackEvent(options?: QueryOptions): Promise<FeedbackEvent | null> {
  const db = dbOf(options);
  const [last] = await db
    .select()
    .from(feedbackEvents)
    .where(isNull(feedbackEvents.undoneAt))
    .orderBy(desc(feedbackEvents.id))
    .limit(1);
  if (!last || !isWeights(last.weightsBefore)) return null;
  const at = (options?.now ?? (() => new Date()))().toISOString();
  await writeWeights(last.weightsBefore, "chat", { at, eventId: last.id, undo: true }, options);
  const [row] = await db
    .update(feedbackEvents)
    .set({ undoneAt: at })
    .where(and(eq(feedbackEvents.id, last.id), isNull(feedbackEvents.undoneAt)))
    .returning();
  await recheckAllListings(options);
  return row ? toEvent(row) : null;
}

/** Feedback events, newest first (default 20), including undone ones. */
export async function getFeedbackEvents(input: { limit?: number } = {}, options?: QueryOptions): Promise<FeedbackEvent[]> {
  const db = dbOf(options);
  const rows = await db
    .select()
    .from(feedbackEvents)
    .orderBy(desc(feedbackEvents.id), asc(feedbackEvents.createdAt))
    .limit(input.limit ?? 20);
  return rows.map(toEvent);
}
