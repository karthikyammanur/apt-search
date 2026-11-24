// The image format change in src/lib/llm/client.ts must not change what reaches the provider.
// Both the deprecated `image` part and the new `file` part go through the real OpenAI-compatible
// provider with a fake transport (no network), and the request bodies must be identical.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { imagePart } from "@/lib/llm/client";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const PNG_BYTES = Uint8Array.from(Buffer.from(PNG_BASE64, "base64"));

async function requestBody(content: ModelMessage["content"]): Promise<unknown> {
  const bodies: unknown[] = [];
  const client = createOpenAICompatible({
    name: "test",
    baseURL: "https://provider.example.test/v1",
    apiKey: "test",
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: "1",
          object: "chat.completion",
          created: 0,
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  await generateText({
    model: client.chatModel("m"),
    messages: [{ role: "user", content } as ModelMessage],
    maxRetries: 0,
  });
  return bodies[0];
}

describe("image parts", () => {
  it("splits a data URL into its media type and base64 payload", () => {
    expect(imagePart(PNG_DATA_URL)).toEqual({
      type: "file",
      mediaType: "image/png",
      data: { type: "data", data: PNG_BASE64 },
    });
  });

  it("gives raw bytes the top-level image type", () => {
    expect(imagePart(PNG_BYTES)).toEqual({ type: "file", mediaType: "image", data: { type: "data", data: PNG_BYTES } });
  });

  it.each([
    { name: "a data URL", image: PNG_DATA_URL },
    { name: "raw bytes", image: PNG_BYTES },
  ])("sends the same request as the old image part for $name", async ({ image }) => {
    const text = { type: "text" as const, text: "Read this screenshot" };
    const before = await requestBody([text, { type: "image", image }]);
    const after = await requestBody([text, imagePart(image)]);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).toContain(`data:image/png;base64,${PNG_BASE64}`);
  });
});
