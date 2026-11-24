// One chat turn end to end: save my message, run the agent over recent history, save the reply
// with its tool results. Every message lands in chat_messages.

import { getChatMessages, saveChatMessage, type QueryOptions } from "@/lib/queries";
import { toModelMessages, type StoredUser } from "./history";
import { runTurn, type TurnResult } from "./loop";
import { buildSystemPrompt } from "./prompt";
import type { ChatModel } from "./providers";
import { createTools, type ToolContext } from "./tools";
import type { ChatEvent, StoredAssistant } from "./types";

export const MAX_USER_TEXT = 20_000;

export type ChatTurnInput = {
  text: string;
  models: ChatModel[];
  ctx?: ToolContext;
  onEvent?: (event: ChatEvent) => void;
  abortSignal?: AbortSignal;
};

export async function chatTurn(input: ChatTurnInput): Promise<TurnResult & { messageId: number }> {
  const options: QueryOptions | undefined = input.ctx?.options;
  const user: StoredUser = { text: input.text.slice(0, MAX_USER_TEXT) };
  await saveChatMessage({ role: "user", content: user }, options);
  const history = await getChatMessages({ limit: 40 }, options);
  const result = await runTurn({
    models: input.models,
    system: buildSystemPrompt(options?.now?.() ?? new Date()),
    messages: toModelMessages(history),
    tools: createTools(input.ctx ?? {}),
    onEvent: input.onEvent,
    abortSignal: input.abortSignal,
  });
  const stored: StoredAssistant = { text: result.text, tools: result.tools, provider: result.provider, notice: result.notice };
  const messageId = await saveChatMessage({ role: "assistant", content: stored }, options);
  return { ...result, messageId };
}
