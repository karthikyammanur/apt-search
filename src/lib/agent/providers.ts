// Chat models: the same provider chain as src/lib/llm, minus the providers whose current model
// is not documented to support tool calling. Checked against each provider's docs on 2026-11-24:
//   gemini      gemini-3.5-flash-lite: model page lists "Function calling: supported"
//   openrouter  nvidia/nemotron-3.5-super-vl:free: model page accepts "tools"
//   groq        openai/gpt-oss-120b: tool use table says yes (no parallel tool calls)
//   sambanova   gpt-oss-120b: listed under function calling "Supported models"
//   zai         glm-4.7-flash: skipped, the docs name tool calling only for the GLM-4.7 series
//               page, not for the Flash model, so it is left out of chat until confirmed.
// A model ID overridden from the environment keeps its provider's verdict; check it by hand.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { configuredProviders, type LlmProvider, type LlmProviderId } from "@/lib/llm";

export const TOOL_CALLING_PROVIDERS: readonly LlmProviderId[] = ["gemini", "openrouter", "groq", "sambanova"];

export type ChatModel = { id: string; model: LanguageModel };

export function chatProviders(env: Record<string, string | undefined> = process.env): LlmProvider[] {
  return configuredProviders(env).filter((p) => TOOL_CALLING_PROVIDERS.includes(p.id));
}

export function toChatModel(provider: LlmProvider): ChatModel {
  const client = createOpenAICompatible({ name: provider.id, baseURL: provider.baseURL, apiKey: provider.apiKey });
  return { id: provider.id, model: client.chatModel(provider.model) };
}

/** The live chain, in fallback order. Empty when no tool-calling provider has a key. */
export function liveChatModels(env: Record<string, string | undefined> = process.env): ChatModel[] {
  return chatProviders(env).map(toChatModel);
}
