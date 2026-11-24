// What the chat screen's buttons do. Apply reads the proposal back from the stored tool result
// (never from the browser or from model text) and applies it once. Undo restores the weights
// before the latest feedback event, but only if it is the event the button belongs to.

import { desc, eq, isNull } from "drizzle-orm";
import { chatMessages, feedbackEvents } from "@/db/schema";
import { getChatMessages, saveChatMessage, updateSettings, type QueryOptions } from "@/lib/queries";
import { dbOf } from "@/lib/queries/shared";
import { isMarker, isStoredAssistant, type StoredMarker } from "./history";
import { undoFeedback } from "./tools/give-feedback";
import { proposableSettingsSchema } from "./tools/propose-settings-change";

export type ActionResult = { ok: true; summary: string } | { ok: false; error: string };

export async function appliedProposals(options?: QueryOptions): Promise<Set<string>> {
  const rows = await getChatMessages({ limit: 500 }, options);
  return new Set(
    rows.flatMap((r) => (r.role === "system" && isMarker(r.content) && r.content.kind === "settings_applied" ? [`${r.content.messageId}:${r.content.toolCallId}`] : [])),
  );
}

export async function applySettingsProposal(input: { messageId: number; toolCallId: string }, options?: QueryOptions): Promise<ActionResult> {
  const db = dbOf(options);
  const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, input.messageId));
  if (!row || row.role !== "assistant" || !isStoredAssistant(row.content)) return { ok: false, error: "no such proposal" };
  const event = row.content.tools.find((t) => t.toolCallId === input.toolCallId && t.toolName === "propose_settings_change");
  const output = event?.output as { ok?: boolean; patch?: unknown } | undefined;
  if (!output?.ok) return { ok: false, error: "no such proposal" };
  if ((await appliedProposals(options)).has(`${input.messageId}:${input.toolCallId}`)) return { ok: false, error: "already applied" };
  const patch = proposableSettingsSchema.safeParse(output.patch);
  if (!patch.success) return { ok: false, error: "the proposal is no longer valid" };
  const result = await updateSettings(patch.data, options);
  if (!result.ok) return { ok: false, error: result.error };
  const marker: StoredMarker = { kind: "settings_applied", messageId: input.messageId, toolCallId: input.toolCallId };
  await saveChatMessage({ role: "system", content: marker }, options);
  return { ok: true, summary: `Applied. ${result.data.listingsRechecked} listings rechecked.` };
}

export async function undoFeedbackEvent(eventId: number, options?: QueryOptions): Promise<ActionResult> {
  const db = dbOf(options);
  const [latest] = await db.select().from(feedbackEvents).where(isNull(feedbackEvents.undoneAt)).orderBy(desc(feedbackEvents.id)).limit(1);
  const [target] = await db.select().from(feedbackEvents).where(eq(feedbackEvents.id, eventId));
  if (!target) return { ok: false, error: "no such change" };
  if (target.undoneAt) return { ok: false, error: "already undone" };
  if (!latest || latest.id !== eventId) return { ok: false, error: "a later change exists; undo that first" };
  const result = await undoFeedback(options);
  if (!result.ok) return result;
  const marker: StoredMarker = { kind: "feedback_undone", eventId };
  await saveChatMessage({ role: "system", content: marker }, options);
  return { ok: true, summary: result.summary };
}
