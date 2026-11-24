// One live chat turn from the command line, for checking a real provider against known data.
// Uses real free model quota, so run it sparingly. It needs an explicit database so it never
// writes chat rows into the dev database by accident:
//
//   npx tsx src/lib/agent/cli.ts --db file:data/demo.db "what's my cheapest listing that passes?"

import { loadEnvConfig } from "@next/env";
import { createDb } from "@/db";
import { chatTurn } from "./chat";
import { liveChatModels } from "./providers";

loadEnvConfig(process.cwd());

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<number> {
  const url = arg("db");
  const args = process.argv.slice(2);
  const at = args.indexOf("--db");
  const text = args.filter((_, i) => i !== at && i !== at + 1).join(" ").trim();
  if (!url || !text) {
    console.error('Usage: npx tsx src/lib/agent/cli.ts --db file:data/demo.db "your question"');
    return 2;
  }
  const models = liveChatModels();
  console.log(`Providers in order: ${models.map((m) => m.id).join(", ") || "none"}`);
  console.log(`\nYou: ${text}\n`);
  const result = await chatTurn({ text, models, ctx: { options: { db: createDb(url) } } });
  for (const failure of result.failures) console.log(`(provider failed: ${failure})`);
  for (const tool of result.tools) {
    console.log(`[tool ${tool.toolName}] input ${JSON.stringify(tool.input)}`);
    console.log(`[tool ${tool.toolName}] output ${JSON.stringify(tool.output).slice(0, 1200)}`);
  }
  console.log(`\nAssistant (${result.provider ?? "none"}, ${result.steps} steps): ${result.text}`);
  if (result.notice) console.log(`(${result.notice})`);
  return result.provider ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Chat turn failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
