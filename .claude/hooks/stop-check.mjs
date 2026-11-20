// Stop hook: blocks Claude Code from ending a turn while `npm run check` fails.
// Written in Node so it behaves the same on Windows, macOS and Linux.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Claude Code sends hook input as JSON on stdin. If this stop was already
// caused by this hook once, let the turn end so it can never loop forever.
let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  input = {};
}
if (input.stop_hook_active) process.exit(0);

if (!existsSync("package.json")) process.exit(0);

const result = spawnSync("npm run check --silent", {
  shell: true,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
writeFileSync(".claude/stop-hook.log", output);

if (result.status === 0) process.exit(0);

process.stderr.write(
  "npm run check is failing. The full output is in .claude/stop-hook.log. " +
    "Fix it, or explain why it cannot pass yet, before ending your turn.\n",
);
process.exit(2);
