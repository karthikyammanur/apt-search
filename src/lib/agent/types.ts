// Shapes shared by the agent loop, the chat route and the chat screen. Types only, no imports
// with side effects, so the client bundle can use them.
//
// The screen renders listing rows, cards, drafts, weight changes and the settings button from
// these tool results, never from model text, so a number on screen is always the stored one.

import type { Bucket } from "@/lib/domain";

export type ListingRow = {
  id: number;
  title: string | null;
  city: string | null;
  bucket: Bucket | null;
  score: number | null;
  /** Integer cents. Null is Unknown. */
  allInMonthlyCents: number | null;
  /** "$1,650.00", or "Unknown". Ready to quote. */
  allInMonthly: string;
  /** Integer minutes, door to office by transit. Null is Unknown. */
  commuteMinutes: number | null;
  commute: string;
  /** Why it failed, the biggest weakness, or the open questions, in one short line. */
  note: string | null;
  userStatus: "none" | "shortlisted" | "rejected";
};

export type ListingCard = ListingRow & {
  /** "added", "duplicate", "skipped", ... from the intake pipeline. */
  intakeStatus: string;
  intakeNote: string | null;
};

export type WeightChangeLine = { factor: string; label: string; before: number; after: number };

export type MovedListing = { id: number; title: string | null; scoreBefore: number | null; scoreAfter: number | null };

export type FeedbackOutput = {
  kind: "feedback";
  eventId: number;
  reason: string;
  changes: WeightChangeLine[];
  /** One line for the screen: "Gym weight 0.12 to 0.06, cafes 0.06 to 0.12." */
  summary: string;
  log: string[];
  moved: MovedListing[];
};

export type SettingsChange = { key: string; label: string; from: string; to: string };

export type SettingsProposal = {
  kind: "settings_proposal";
  /** The validated patch. Only the Apply button in the UI writes it. */
  patch: Record<string, unknown>;
  changes: SettingsChange[];
  reason: string;
  applied: false;
};

export type DraftOutput = {
  kind: "draft";
  to: string;
  purpose: string;
  text: string;
};

export type ToolError = { ok: false; error: string };

/** One tool call and its result, as the screen sees it. */
export type ToolEvent = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
};

/** What the chat route streams, one JSON object per line. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; tool: ToolEvent }
  | { type: "provider"; provider: string }
  | { type: "notice"; text: string }
  | { type: "error"; text: string }
  | { type: "done"; messageId: number | null };

/** The stored assistant message (chat_messages.content). */
export type StoredAssistant = {
  text: string;
  tools: ToolEvent[];
  provider: string | null;
  notice: string | null;
};
