// The agent loop with scripted fake models (the AI SDK's MockLanguageModelV4): a tool call then
// an answer, provider fallback, no retry once a tool ran, and the 6-step cap.

import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { chatTurn } from "@/lib/agent/chat";
import { scriptedModel, textParts, toolParts, turnState } from "@/lib/agent/fake";
import { MAX_STEPS } from "@/lib/agent/loop";
import type { ChatModel } from "@/lib/agent/providers";
import { TOOL_CALLING_PROVIDERS, chatProviders } from "@/lib/agent/providers";
import type { ChatEvent, ListingRow } from "@/lib/agent/types";
import { getBoard, getChatMessages } from "@/lib/queries";
import { contextFor, demoDb, NOW } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await demoDb();
});

function failingModel(id: string): ChatModel {
  return {
    id,
    model: new MockLanguageModelV4({
      doStream: async () => {
        throw Object.assign(new Error("rate limited"), { statusCode: 429 });
      },
    }),
  };
}

const searchThenAnswer = scriptedModel("second", (options) =>
  turnState(options).toolsCalled.length === 0
    ? toolParts([{ toolName: "search_listings", input: { bucket: "pass", sort: "cost", limit: 1 } }])
    : textParts("That is your cheapest listing that passes."),
);

describe("agent loop", () => {
  it("calls search_listings, then answers; both messages are saved", async () => {
    const events: ChatEvent[] = [];
    const result = await chatTurn({
      text: "what's my cheapest listing that passes?",
      models: [searchThenAnswer],
      ctx: contextFor(db),
      onEvent: (e) => events.push(e),
    });
    expect(result.provider).toBe("second");
    expect(result.steps).toBe(2);
    expect(result.tools.map((t) => t.toolName)).toEqual(["search_listings"]);
    const rows = (result.tools[0]!.output as { rows: ListingRow[] }).rows;
    const board = await getBoard({ bucket: "pass" }, { db });
    const cheapest = Math.min(...board.items.map((i) => i.allInMonthlyCents ?? Infinity));
    expect(rows[0]!.allInMonthlyCents).toBe(cheapest);
    expect(result.text).toBe("That is your cheapest listing that passes.");
    expect(events.map((e) => e.type)).toEqual(["provider", "tool", "text"]);

    const stored = await getChatMessages({}, { db });
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(stored[1]!.content).toMatchObject({ text: result.text, provider: "second", tools: [{ toolName: "search_listings" }] });
  });

  it("falls through to the next provider when the first fails before any output", async () => {
    const result = await chatTurn({ text: "cheapest that passes?", models: [failingModel("first"), searchThenAnswer], ctx: contextFor(db) });
    expect(result.provider).toBe("second");
    expect(result.failures).toEqual(["first: HTTP 429"]);
    expect(result.text).toBe("That is your cheapest listing that passes.");
  });

  it("does not retry on another provider once a tool has run", async () => {
    let calls = 0;
    const flaky: ChatModel = {
      id: "flaky",
      model: new MockLanguageModelV4({
        doStream: async () => {
          calls += 1;
          if (calls > 1) throw new Error("server error");
          return { stream: new ReadableStream({ start: (c) => { for (const p of toolParts([{ toolName: "search_listings", input: {} }])) c.enqueue(p); c.close(); } }) };
        },
      }),
    };
    const backup = scriptedModel("backup", () => textParts("should not run"));
    const result = await chatTurn({ text: "anything new?", models: [flaky, backup], ctx: contextFor(db) });
    expect(result.provider).toBe("flaky");
    expect(result.tools).toHaveLength(1);
    expect(result.text).toBe("");
    expect(result.notice).toMatch(/stopped partway/);
  });

  it("reports when every provider fails, and when none is configured", async () => {
    const all = await chatTurn({ text: "hi", models: [failingModel("a"), failingModel("b")], ctx: contextFor(db) });
    expect(all.provider).toBeNull();
    expect(all.failures).toHaveLength(2);
    const none = await chatTurn({ text: "hi", models: [], ctx: contextFor(db) });
    expect(none.notice).toMatch(/No chat model/);
  });

  it(`stops a turn after ${MAX_STEPS} model steps`, async () => {
    let step = 0;
    const loopy = scriptedModel("loopy", () => toolParts([{ toolName: "search_listings", input: { limit: 1 } }], step++));
    const result = await chatTurn({ text: "keep searching", models: [loopy], ctx: contextFor(db) });
    expect(step).toBe(MAX_STEPS);
    expect(result.steps).toBe(MAX_STEPS);
    expect(result.tools).toHaveLength(MAX_STEPS);
    expect(result.notice).toBe(`Stopped after ${MAX_STEPS} steps. Ask again to continue.`);
  });

  it("sends earlier turns back as history, starting with a user message", async () => {
    await chatTurn({ text: "first question", models: [scriptedModel("m", () => textParts("first answer"))], ctx: contextFor(db) });
    let seen: string[] = [];
    const spy = scriptedModel("m", (options) => {
      seen = options.prompt.map((m) => m.role);
      return textParts("second answer");
    });
    await chatTurn({ text: "second question", models: [spy], ctx: { options: { db, now: () => NOW } } });
    expect(seen).toEqual(["system", "user", "assistant", "user"]);
  });
});

describe("chat providers", () => {
  it("keeps only providers documented to support tool calling", () => {
    const env = { GEMINI_API_KEY: "k", GROQ_API_KEY: "k", ZAI_API_KEY: "k", SAMBANOVA_API_KEY: " " };
    expect(chatProviders(env).map((p) => p.id)).toEqual(["gemini", "groq"]);
    expect(TOOL_CALLING_PROVIDERS).not.toContain("zai");
  });
});
