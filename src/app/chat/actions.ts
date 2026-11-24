"use server";

// The only two writes the chat screen makes itself. Both run on a button press, after the
// login check, and read what they apply from the database, not from the browser.

import { cookies } from "next/headers";
import { applySettingsProposal, undoFeedbackEvent, type ActionResult } from "@/lib/agent/actions";
import { SESSION_COOKIE, verifySession } from "@/app/login/session";

async function signedIn(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return Boolean(token && (await verifySession(token, process.env.APP_PASSWORD ?? "")));
}

export async function applySettingsAction(messageId: number, toolCallId: string): Promise<ActionResult> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in" };
  if (!Number.isInteger(messageId) || typeof toolCallId !== "string") return { ok: false, error: "bad request" };
  return applySettingsProposal({ messageId, toolCallId });
}

export async function undoFeedbackAction(eventId: number): Promise<ActionResult> {
  if (!(await signedIn())) return { ok: false, error: "Not signed in" };
  if (!Number.isInteger(eventId)) return { ok: false, error: "bad request" };
  return undoFeedbackEvent(eventId);
}
