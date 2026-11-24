// Agent test helpers: a fresh in-memory database with the demo data, the tools bound to it, and
// a way to call one tool the way the AI SDK does (input parsed by its Zod schema first).
// Nothing here touches the network: paste runs use the stub model and map services.

import type { z } from "zod";
import { createDb, type Db } from "@/db";
import { seedDemo } from "@/db/demo";
import { runMigrations } from "@/db/run-migrations";
import { stubExtractionLlm, stubGeo } from "@/lib/agent/fake";
import { createTools, type AgentTools, type ToolContext } from "@/lib/agent/tools";
import { createDeps } from "@/lib/intake";

export const NOW = new Date("2026-12-01T16:00:00Z");

export async function demoDb(): Promise<Db> {
  const db = createDb(":memory:");
  await runMigrations(db);
  await seedDemo(db, { now: NOW });
  return db;
}

export function contextFor(db: Db): ToolContext {
  const options = { db, now: () => NOW };
  return { options, intakeDeps: () => createDeps({ db, now: () => NOW, llm: stubExtractionLlm, geo: stubGeo }) };
}

export function toolsFor(db: Db): AgentTools {
  return createTools(contextFor(db));
}

/** Parse the input with the tool's schema (defaults applied), then run it. */
export async function call<K extends keyof AgentTools>(tools: AgentTools, name: K, input: unknown): Promise<Record<string, unknown>> {
  const t = tools[name] as unknown as { inputSchema: z.ZodType; execute: (input: unknown, options: unknown) => Promise<unknown> };
  const parsed = t.inputSchema.parse(input);
  return (await t.execute(parsed, { toolCallId: "test", messages: [] })) as Record<string, unknown>;
}

/** True when the tool's schema rejects the input. */
export function rejects<K extends keyof AgentTools>(tools: AgentTools, name: K, input: unknown): boolean {
  const t = tools[name] as unknown as { inputSchema: z.ZodType };
  return !t.inputSchema.safeParse(input).success;
}
