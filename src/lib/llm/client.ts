// One OpenAI-compatible client over the Vercel AI SDK, with a fallback chain.
//
//   generateStructured(schema, prompt, { images? })
//
// Output is parsed as JSON and validated with Zod. If it does not validate, the model gets one
// repair turn that shows the problem. Errors never throw across this boundary: callers get
// { ok: true, data } or { ok: false, error }.
//
// Images must be data: URLs or raw bytes. The AI SDK downloads any http image URL itself, and
// the server never downloads listing photos (docs/design.md, "photos"), so remote URLs are
// rejected up front.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText } from "ai";
import { z } from "zod";
import { configuredProviders, type LlmProvider, type LlmProviderId } from "./providers";

export type LlmImage = string | Uint8Array;

export type LlmError = "no_providers" | "bad_images" | "all_providers_failed" | "invalid_output";

export type LlmResult<T> =
  | { ok: true; data: T; provider: LlmProviderId }
  | { ok: false; error: LlmError; detail?: string };

export type GenerateOptions = {
  images?: LlmImage[];
  /** Extra system instructions, placed before the JSON schema instructions. */
  system?: string;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** One model turn. Throws on any API failure so the chain can try the next provider. */
export type CompleteFn = (
  provider: LlmProvider,
  request: { system: string; messages: ChatMessage[]; images: LlmImage[] },
) => Promise<string>;

export type LlmOptions = {
  providers?: LlmProvider[];
  complete?: CompleteFn;
};

const MAX_IMAGES = 4;

/** Accept only data: URLs and raw bytes. */
export function validateImages(images: LlmImage[]): boolean {
  return (
    images.length <= MAX_IMAGES &&
    images.every((image) =>
      typeof image === "string"
        ? /^data:image\/[a-z0-9.+-]+;base64,/i.test(image)
        : image.length > 0,
    )
  );
}

const defaultComplete: CompleteFn = async (provider, request) => {
  const client = createOpenAICompatible({
    name: provider.id,
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
  });
  const model =
    request.images.length > 0 ? (provider.visionModel ?? provider.model) : provider.model;
  const last = request.messages.length - 1;
  const messages = request.messages.map((message, index) =>
    index === last && message.role === "user" && request.images.length > 0
      ? {
          role: "user" as const,
          content: [
            { type: "text" as const, text: message.content },
            ...request.images.map((image) => ({ type: "image" as const, image })),
          ],
        }
      : message,
  );
  const result = await generateText({
    model: client.chatModel(model),
    system: request.system,
    messages,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(60_000),
  });
  return result.text;
};

/** Pull the first JSON object or array out of a reply, tolerating code fences and chatter. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text;
  const start = fenced.search(/[{[]/);
  if (start < 0) throw new Error("No JSON found in reply");
  const close = fenced[start] === "{" ? "}" : "]";
  const end = fenced.lastIndexOf(close);
  if (end <= start) throw new Error("Unterminated JSON in reply");
  return JSON.parse(fenced.slice(start, end + 1));
}

function describeError(error: unknown): string {
  if (APICallError.isInstance(error)) return `HTTP ${error.statusCode ?? "?"}`;
  return error instanceof Error ? error.name : "error";
}

function parseReply<T>(
  schema: z.ZodType<T>,
  reply: string,
): { ok: true; data: T } | { ok: false; problem: string } {
  let json: unknown;
  try {
    json = extractJson(reply);
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : "not JSON" };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    problem: parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; "),
  };
}

export function createLlm(options: LlmOptions = {}) {
  const complete = options.complete ?? defaultComplete;

  async function generateStructured<T>(
    schema: z.ZodType<T>,
    prompt: string,
    opts: GenerateOptions = {},
  ): Promise<LlmResult<T>> {
    const images = opts.images ?? [];
    if (!validateImages(images)) return { ok: false, error: "bad_images" };
    const providers = (options.providers ?? configuredProviders()).filter(
      (p) => images.length === 0 || p.visionModel !== null,
    );
    if (providers.length === 0) return { ok: false, error: "no_providers" };

    const system = [
      opts.system,
      "Reply with one JSON value and nothing else. It must match this JSON Schema:",
      JSON.stringify(z.toJSONSchema(schema)),
    ]
      .filter(Boolean)
      .join("\n");

    const failures: string[] = [];
    for (const provider of providers) {
      let reply: string;
      try {
        reply = await complete(provider, {
          system,
          messages: [{ role: "user", content: prompt }],
          images,
        });
      } catch (error) {
        // 429, 5xx, timeouts, a retired model ID: whatever the reason, try the next provider.
        failures.push(`${provider.id}: ${describeError(error)}`);
        continue;
      }
      const first = parseReply(schema, reply);
      if (first.ok) return { ok: true, data: first.data, provider: provider.id };
      // One repair turn on the same provider, showing the problem.
      try {
        const repaired = await complete(provider, {
          system,
          images: [],
          messages: [
            { role: "user", content: prompt },
            { role: "assistant", content: reply.slice(0, 4000) },
            {
              role: "user",
              content: `That reply did not match the schema: ${first.problem}. Reply again with only the corrected JSON.`,
            },
          ],
        });
        const second = parseReply(schema, repaired);
        if (second.ok) return { ok: true, data: second.data, provider: provider.id };
        return { ok: false, error: "invalid_output", detail: second.problem };
      } catch (error) {
        failures.push(`${provider.id} (repair): ${describeError(error)}`);
      }
    }
    return { ok: false, error: "all_providers_failed", detail: failures.join("; ") };
  }

  return { generateStructured };
}

export type Llm = ReturnType<typeof createLlm>;
