// POST /api/chat { text } streams one assistant turn as an AI SDK UI message stream. Each of
// our events (src/lib/agent/types.ts ChatEvent) rides in a "data-event" chunk, read on the
// client by the SDK's DefaultChatTransport. The proxy already requires the login cookie for /api/*;
// the route checks it again so it never runs signed out.

import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";
import { chatTurn, MAX_USER_TEXT } from "@/lib/agent/chat";
import { e2eScript, fakeModeEnabled, scriptedModel, stubExtractionLlm, stubGeo } from "@/lib/agent/fake";
import { liveChatModels } from "@/lib/agent/providers";
import type { ToolContext } from "@/lib/agent/tools";
import type { ChatEvent } from "@/lib/agent/types";
import { createDeps } from "@/lib/intake";
import { SESSION_COOKIE, verifySession } from "@/app/login/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ text: z.string().trim().min(1).max(MAX_USER_TEXT) });

export async function POST(request: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token, process.env.APP_PASSWORD ?? ""))) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { text } with 1 to 20,000 characters." }, { status: 400 });

  const fake = fakeModeEnabled();
  const models = fake ? [scriptedModel("fake", e2eScript)] : liveChatModels();
  const ctx: ToolContext = fake ? { intakeDeps: () => createDeps({ llm: stubExtractionLlm, geo: stubGeo }) } : {};

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const send = (event: ChatEvent) => writer.write({ type: "data-event", data: event, transient: true });
      try {
        const result = await chatTurn({ text: parsed.data.text, models, ctx, onEvent: send, abortSignal: request.signal });
        send({ type: "done", messageId: result.messageId });
      } catch (error) {
        console.error("chat turn failed:", error instanceof Error ? error.message : error);
        send({ type: "error", text: "Something went wrong saving this turn. Try again." });
        send({ type: "done", messageId: null });
      }
    },
    onError: () => "The chat failed. Try again.",
  });
  return createUIMessageStreamResponse({ stream, headers: { "Cache-Control": "no-store" } });
}
