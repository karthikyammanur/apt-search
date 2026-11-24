// One chat turn: stream the model's reply with tool calling, at most MAX_STEPS model steps.
//
// Fallback: if a provider fails before anything reached the user (no text and no tool result),
// the turn is retried on the next provider. Once a tool has run, a retry could repeat a write
// (a second feedback event), so a later failure ends the turn with an error instead.

import { isStepCount, streamText, type ModelMessage, type ToolSet } from "ai";
import type { ChatModel } from "./providers";
import type { ChatEvent, StoredAssistant, ToolEvent } from "./types";

export const MAX_STEPS = 6;

export type TurnInput = {
  models: ChatModel[];
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  onEvent?: (event: ChatEvent) => void;
  abortSignal?: AbortSignal;
};

export type TurnResult = StoredAssistant & { failures: string[]; steps: number };

function describe(error: unknown): string {
  if (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") return `HTTP ${error.statusCode}`;
  if (error instanceof Error) return error.message.slice(0, 120) || error.name;
  return "error";
}

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const emit = input.onEvent ?? (() => {});
  const failures: string[] = [];
  if (input.models.length === 0) {
    const text = "No chat model is configured. Add a key for Gemini, OpenRouter, Groq or SambaNova.";
    emit({ type: "error", text });
    return { text: "", tools: [], provider: null, notice: text, failures, steps: 0 };
  }

  for (const { id, model } of input.models) {
    let text = "";
    const tools: ToolEvent[] = [];
    const calls = new Map<string, { toolName: string; input: unknown }>();
    let steps = 0;
    let failed: unknown = null;
    let stoppedByCap = false;

    const result = streamText({
      model,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      stopWhen: isStepCount(MAX_STEPS),
      maxRetries: 0,
      temperature: 0,
      abortSignal: input.abortSignal,
      onError: () => {},
    });

    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          if (text === "" && tools.length === 0) emit({ type: "provider", provider: id });
          text += part.text;
          emit({ type: "text", text: part.text });
        } else if (part.type === "tool-call") {
          calls.set(part.toolCallId, { toolName: part.toolName, input: part.input });
        } else if (part.type === "tool-result" || part.type === "tool-error") {
          if (text === "" && tools.length === 0) emit({ type: "provider", provider: id });
          const call = calls.get(part.toolCallId);
          const event: ToolEvent = {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: call?.input ?? part.input,
            output: part.type === "tool-result" ? part.output : { ok: false, error: describe(part.error) },
          };
          tools.push(event);
          emit({ type: "tool", tool: event });
        } else if (part.type === "finish-step") {
          steps += 1;
          if (steps >= MAX_STEPS && part.finishReason === "tool-calls") stoppedByCap = true;
        } else if (part.type === "error") {
          failed = part.error;
          break;
        }
      }
    } catch (error) {
      failed = error;
    }

    if (failed !== null) {
      failures.push(`${id}: ${describe(failed)}`);
      if (text === "" && tools.length === 0) continue;
      const notice = "The model stopped partway through. Try again.";
      emit({ type: "error", text: notice });
      return { text, tools, provider: id, notice, failures, steps };
    }

    let notice: string | null = null;
    if (stoppedByCap) {
      notice = `Stopped after ${MAX_STEPS} steps. Ask again to continue.`;
      emit({ type: "notice", text: notice });
    }
    return { text, tools, provider: id, notice, failures, steps };
  }

  const notice = "Every chat model failed. Try again in a minute.";
  emit({ type: "error", text: notice });
  return { text: "", tools: [], provider: null, notice, failures, steps: 0 };
}
