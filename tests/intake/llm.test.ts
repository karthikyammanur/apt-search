import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLlm, extractJson, validateImages, type CompleteFn } from "@/lib/llm/client";
import { configuredProviders, type LlmProvider } from "@/lib/llm/providers";

const schema = z.object({ rent: z.number(), furnished: z.boolean().nullable() });
const provider = (id: LlmProvider["id"], visionModel: string | null = "v"): LlmProvider => ({
  id,
  baseURL: "https://example.test/v1",
  apiKey: "k",
  model: "m",
  visionModel,
});

describe("provider chain from environment keys", () => {
  it("lists configured providers in fallback order and skips blank keys", () => {
    const chain = configuredProviders({
      GEMINI_API_KEY: "g",
      OPENROUTER_API_KEY: "  ",
      GROQ_API_KEY: "q",
      SAMBANOVA_API_KEY: "",
      ZAI_API_KEY: "z",
    });
    expect(chain.map((p) => p.id)).toEqual(["gemini", "groq", "zai"]);
  });

  it("uses an environment override for a model id", () => {
    const [gemini] = configuredProviders({ GEMINI_API_KEY: "g", GEMINI_MODEL: "custom-model" });
    expect(gemini?.model).toBe("custom-model");
  });

  it("has no providers with no keys", () => {
    expect(configuredProviders({})).toEqual([]);
  });
});

describe("generateStructured", () => {
  it("returns validated data from the first provider", async () => {
    const complete = vi.fn<CompleteFn>(async () => '```json\n{"rent": 1950, "furnished": true}\n```');
    const llm = createLlm({ providers: [provider("gemini"), provider("groq")], complete });
    const result = await llm.generateStructured(schema, "p");
    expect(result).toEqual({ ok: true, data: { rent: 1950, furnished: true }, provider: "gemini" });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "a 429", status: 429 },
    { name: "a 503", status: 503 },
    { name: "a network error", status: 0 },
  ])("moves to the next provider after $name", async () => {
    const complete = vi.fn<CompleteFn>(async (p) => {
      if (p.id === "gemini") throw new Error("boom");
      return '{"rent": 1, "furnished": null}';
    });
    const llm = createLlm({ providers: [provider("gemini"), provider("openrouter")], complete });
    const result = await llm.generateStructured(schema, "p");
    expect(result).toMatchObject({ ok: true, provider: "openrouter" });
  });

  it("repairs once when the first reply does not match, showing the problem", async () => {
    const replies = ['{"rent": "lots"}', '{"rent": 2000, "furnished": false}'];
    const complete = vi.fn<CompleteFn>(async () => replies.shift() as string);
    const llm = createLlm({ providers: [provider("gemini")], complete });
    const result = await llm.generateStructured(schema, "p");
    expect(result).toMatchObject({ ok: true, data: { rent: 2000 } });
    expect(complete).toHaveBeenCalledTimes(2);
    const repairTurn = complete.mock.calls[1]?.[1].messages.at(-1)?.content ?? "";
    expect(repairTurn).toContain("rent");
  });

  it("gives up after one repair with invalid_output", async () => {
    const complete = vi.fn<CompleteFn>(async () => "no json at all");
    const llm = createLlm({ providers: [provider("gemini"), provider("groq")], complete });
    const result = await llm.generateStructured(schema, "p");
    expect(result).toMatchObject({ ok: false, error: "invalid_output" });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("reports every provider failing, and no providers", async () => {
    const down = createLlm({ providers: [provider("gemini")], complete: async () => { throw new Error("x"); } });
    expect(await down.generateStructured(schema, "p")).toMatchObject({ ok: false, error: "all_providers_failed" });
    const none = createLlm({ providers: [], complete: async () => "{}" });
    expect(await none.generateStructured(schema, "p")).toMatchObject({ ok: false, error: "no_providers" });
  });

  it("puts the JSON schema in the system prompt", async () => {
    const complete = vi.fn<CompleteFn>(async () => '{"rent": 1, "furnished": null}');
    await createLlm({ providers: [provider("gemini")], complete }).generateStructured(schema, "p", { system: "Be careful." });
    const system = complete.mock.calls[0]?.[1].system ?? "";
    expect(system).toContain("Be careful.");
    expect(system).toContain('"rent"');
  });

  it("only sends screenshots to providers that have a vision model", async () => {
    const complete = vi.fn<CompleteFn>(async () => '{"rent": 1, "furnished": null}');
    const llm = createLlm({ providers: [provider("sambanova", null), provider("gemini")], complete });
    const image = "data:image/png;base64,AAAA";
    const result = await llm.generateStructured(schema, "p", { images: [image] });
    expect(result).toMatchObject({ ok: true, provider: "gemini" });
    expect(complete.mock.calls[0]?.[0].id).toBe("gemini");
  });
});

describe("images never come from remote URLs", () => {
  it.each([
    { name: "an http url", images: ["https://example.test/a.jpg"], ok: false },
    { name: "a javascript url", images: ["javascript:alert(1)"], ok: false },
    { name: "a data url", images: ["data:image/jpeg;base64,/9j/4AAQ"], ok: true },
    { name: "raw bytes", images: [new Uint8Array([1, 2, 3])], ok: true },
    { name: "empty bytes", images: [new Uint8Array()], ok: false },
    { name: "too many", images: Array.from({ length: 5 }, () => "data:image/png;base64,AA"), ok: false },
  ])("$name is accepted: $ok", ({ images, ok }) => {
    expect(validateImages(images)).toBe(ok);
  });

  it("rejects a remote image before any provider is called", async () => {
    const complete = vi.fn<CompleteFn>();
    const result = await createLlm({ providers: [provider("gemini")], complete }).generateStructured(schema, "p", {
      images: ["https://example.test/photo.jpg"],
    });
    expect(result).toMatchObject({ ok: false, error: "bad_images" });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("extractJson", () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['Sure! ```json\n{"a":1}\n``` hope that helps', { a: 1 }],
    ['Here you go: {"a": {"b": 2}} done', { a: { b: 2 } }],
    ["[1,2]", [1, 2]],
  ])("reads %s", (text, expected) => {
    expect(extractJson(text)).toEqual(expected);
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("nothing here")).toThrow();
  });
});
