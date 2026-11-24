// A scripted chat model and stub map and extraction services, for end-to-end tests only. The
// chat route uses them only when AGENT_FAKE_MODEL=1 and the database is a local file (never
// in production). The script picks tools from my message, and its replies hold no numbers, so
// every number on screen still comes from a tool result.

import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import type { z } from "zod";
import type { FeedbackChange } from "@/lib/domain";
import type { IntakeDeps } from "@/lib/intake";
import type { Geo } from "@/lib/intake/geo";
import type { LlmResult } from "@/lib/llm";
import type { ChatModel } from "./providers";

type DoStream = MockLanguageModelV4["doStream"];
export type LanguageModelV4CallOptions = Parameters<DoStream>[0];
export type LanguageModelV4StreamPart = Awaited<ReturnType<DoStream>>["stream"] extends ReadableStream<infer P> ? P : never;

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

export function textParts(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", usage: USAGE, finishReason: { unified: "stop", raw: undefined } },
  ];
}

export function toolParts(calls: { toolName: string; input: unknown }[], step = 0): LanguageModelV4StreamPart[] {
  return [
    ...calls.map((c, i): LanguageModelV4StreamPart => ({
      type: "tool-call",
      toolCallId: `call-${step}-${i}-${c.toolName}`,
      toolName: c.toolName,
      input: JSON.stringify(c.input),
    })),
    { type: "finish", usage: USAGE, finishReason: { unified: "tool-calls", raw: undefined } },
  ];
}

/** A model whose every step is decided by `script` from the prompt it was given. */
export function scriptedModel(id: string, script: (options: LanguageModelV4CallOptions) => LanguageModelV4StreamPart[]): ChatModel {
  return {
    id,
    model: new MockLanguageModelV4({
      provider: id,
      modelId: `${id}-scripted`,
      doStream: async (options) => ({ stream: convertArrayToReadableStream(script(options)) }),
    }),
  };
}

/** The text of the last user message, and the tool names called since it. */
export function turnState(options: LanguageModelV4CallOptions): { userText: string; toolsCalled: string[] } {
  const prompt = options.prompt;
  let lastUser = -1;
  prompt.forEach((m, i) => {
    if (m.role === "user") lastUser = i;
  });
  const user = prompt[lastUser];
  const userText =
    user && user.role === "user" ? user.content.map((p) => (p.type === "text" ? p.text : "")).join("") : "";
  const toolsCalled = prompt
    .slice(lastUser + 1)
    .flatMap((m) => (m.role === "tool" ? m.content.flatMap((p) => (p.type === "tool-result" ? [p.toolName] : [])) : []));
  return { userText, toolsCalled };
}

function feedbackChanges(reason: string): FeedbackChange[] {
  const r = reason.toLowerCase();
  if (/caltrain|train|transit|bus/.test(r)) return [{ factor: "transit_quality", direction: "up", size: "medium" }];
  if (/gym/.test(r)) return [{ factor: "gym", direction: "down", size: "medium" }, { factor: "cafes", direction: "up", size: "medium" }];
  if (/far|commute/.test(r)) return [{ factor: "commute", direction: "up", size: "medium" }];
  if (/price|expensive|cost/.test(r)) return [{ factor: "budget_headroom", direction: "up", size: "medium" }];
  return [{ factor: "reviews_trust", direction: "up", size: "small" }];
}

/** The e2e script: paste, reject with a reason, undo, cheapest, or a plain search. */
export function e2eScript(options: LanguageModelV4CallOptions): LanguageModelV4StreamPart[] {
  const { userText, toolsCalled } = turnState(options);
  if (toolsCalled.length > 0) {
    if (toolsCalled.includes("add_listing_from_text")) return textParts("Added it. Its card is below.");
    if (toolsCalled.includes("give_feedback")) return textParts("Rejected it, and I changed the weights to match your reason.");
    if (toolsCalled.includes("undo_feedback")) return textParts("Undone.");
    return textParts("Here is what I found.");
  }
  const reject = /^reject (?:listing )?#?(\d+)[:,.]?\s*(.*)$/i.exec(userText.trim());
  if (reject) {
    const listingId = Number(reject[1]);
    const reason = reject[2]?.trim() || "not a fit";
    return toolParts([
      { toolName: "set_listing_status", input: { listingId, status: "rejected", reason } },
      { toolName: "give_feedback", input: { reason, listingId, changes: feedbackChanges(reason) } },
    ]);
  }
  if (/^undo\b/i.test(userText.trim())) return toolParts([{ toolName: "undo_feedback", input: {} }]);
  if (userText.length > 80 && /\$\s?\d/.test(userText)) {
    return toolParts([{ toolName: "add_listing_from_text", input: { text: userText } }]);
  }
  if (/cheapest/i.test(userText)) {
    return toolParts([{ toolName: "search_listings", input: { bucket: "pass", sort: "cost", limit: 1 } }]);
  }
  return toolParts([{ toolName: "search_listings", input: { limit: 5 } }]);
}

const HOME = { lat: 37.4292, lng: -122.1381 };

/** Map services that answer from fixed numbers, with no network. */
export const stubGeo: Geo = {
  async geocode(address) {
    return { ok: true, data: { ...HOME, address } };
  },
  async transit() {
    return {
      ok: true,
      data: {
        minutes: 22,
        steps: [
          { mode: "WALK", lineName: null, minutes: 5 },
          { mode: "TRANSIT", lineName: "Caltrain Local", minutes: 11 },
          { mode: "WALK", lineName: null, minutes: 6 },
        ],
      },
    };
  },
  async walkBike(_from, _to, mode) {
    return { ok: true, data: { minutes: mode === "BICYCLE" ? 14 : 6, steps: [] } };
  },
  async places() {
    return {
      ok: true,
      data: [
        { id: "g1", name: "Sample Market", lat: HOME.lat + 0.003, lng: HOME.lng, types: ["grocery_store"], rating: 4.3 },
        { id: "y1", name: "Sample Gym", lat: HOME.lat, lng: HOME.lng + 0.004, types: ["gym"], rating: 4.4 },
        { id: "c1", name: "Sample Cafe", lat: HOME.lat + 0.001, lng: HOME.lng, types: ["cafe"], rating: 4.5 },
      ],
    };
  },
};

/** Pulls the rent and a few obvious facts out of the text with regexes, standing in for the model. */
export const stubExtractionLlm: IntakeDeps["llm"] = {
  async generateStructured<T>(schema: z.ZodType<T>, prompt: string): Promise<LlmResult<T>> {
    const rent = /\$\s?([\d,]{3,6})/.exec(prompt)?.[1];
    const address = /\b(\d+ [A-Z][a-z]+ (?:St|Ave|Way|Rd|Dr|Ct)[^,\n]*, [A-Z][a-z]+(?: [A-Z][a-z]+)?, CA)/.exec(prompt)?.[1] ?? null;
    const value = {
      post_type: "room_offered",
      type: "room",
      address,
      city: address ? address.split(",")[1]?.trim() : null,
      rent_usd: rent ? Number(rent.replace(/,/g, "")) : null,
      mandatory_fees_monthly_usd: /no fees/i.test(prompt) ? 0 : null,
      short_term_premium_usd: /no fees/i.test(prompt) ? 0 : null,
      one_time_fees_usd: /no fees/i.test(prompt) ? 0 : null,
      non_refundable_deposit_usd: /no fees/i.test(prompt) ? 0 : null,
      basics_provided: /fully furnished/i.test(prompt) ? true : null,
      utilities_included: /utilities (?:and wifi )?included/i.test(prompt) ? true : null,
      internet_included: /wifi included/i.test(prompt) ? true : null,
      private_bedroom: /private (?:room|bedroom)/i.test(prompt) ? true : null,
      private_bath: /private bath|own bathroom/i.test(prompt) ? true : null,
      furnished: /furnished/i.test(prompt) ? true : null,
      available_from: "2027-01-02",
      lease_type: "fixed",
      lease_end: "2027-08-31",
    };
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { ok: true, data: parsed.data, provider: "gemini" }
      : { ok: false, error: "invalid_output", detail: "stub extraction did not match" };
  },
};

/** True only for the e2e server: the flag is set and the database is a local file. */
export function fakeModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AGENT_FAKE_MODEL === "1" && (env.DATABASE_URL ?? "").startsWith("file:") && env.VERCEL !== "1";
}
