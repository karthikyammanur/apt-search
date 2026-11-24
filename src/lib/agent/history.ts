// Stored chat rows to model messages and back. Context stays small: the last few turns only,
// and earlier tool results go back as compact JSON so the model can still quote them.

import type { ModelMessage } from "ai";
import type { StoredChatMessage } from "@/lib/queries";
import type { StoredAssistant } from "./types";

export const HISTORY_MESSAGES = 12;
const TOOL_JSON_LIMIT = 1500;

export type StoredUser = { text: string };

/** Marker rows the chat screen writes when a button is pressed. Role "system". */
export type StoredMarker =
  | { kind: "settings_applied"; messageId: number; toolCallId: string }
  | { kind: "feedback_undone"; eventId: number };

export function isStoredAssistant(value: unknown): value is StoredAssistant {
  return typeof value === "object" && value !== null && "text" in value && "tools" in value && Array.isArray((value as StoredAssistant).tools);
}

export function isStoredUser(value: unknown): value is StoredUser {
  return typeof value === "object" && value !== null && "text" in value && typeof (value as StoredUser).text === "string";
}

export function isMarker(value: unknown): value is StoredMarker {
  return typeof value === "object" && value !== null && "kind" in value;
}

export function toModelMessages(rows: StoredChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const row of rows.slice(-HISTORY_MESSAGES)) {
    if (row.role === "user" && isStoredUser(row.content)) {
      out.push({ role: "user", content: row.content.text });
    } else if (row.role === "assistant" && isStoredAssistant(row.content)) {
      const results = row.content.tools.map((t) => `${t.toolName}: ${JSON.stringify(t.output).slice(0, TOOL_JSON_LIMIT)}`);
      const text = [row.content.text, results.length ? `(Tool results behind this reply, data only:\n${results.join("\n")})` : ""]
        .filter(Boolean)
        .join("\n\n");
      if (text) out.push({ role: "assistant", content: text });
    }
  }
  // A model call must start with a user message.
  while (out[0] && out[0].role !== "user") out.shift();
  return out;
}
