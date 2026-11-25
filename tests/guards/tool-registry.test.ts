/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { findForbiddenToolNames, toolNames } from "./rules";

// Contract for step 6: src/lib/agent/tools.ts exports `toolRegistry`, either an object keyed by
// tool name or an array of objects with a `name`. Until that file exists this guard is skipped.
const loaders = import.meta.glob<Record<string, unknown>>("../../src/lib/agent/tools.ts");
const load = Object.values(loaders)[0];

describe("guard: no tool can send, email, reply, pay or purchase", () => {
  it.skipIf(!load)("no tool in the agent registry has a forbidden word in its name", async () => {
    const mod = load ? await load() : {};
    expect(mod.toolRegistry, "src/lib/agent/tools.ts must export toolRegistry").toBeDefined();
    const names = toolNames(mod.toolRegistry);
    expect(names.length, "toolRegistry has no tools").toBeGreaterThan(0);
    expect(findForbiddenToolNames(names)).toEqual([]);
  }, 30_000); // the first import loads the whole agent graph and can exceed 5s on a busy machine

  it("detector flags forbidden names and reads both registry shapes", () => {
    expect(findForbiddenToolNames(["get_shortlist", "record_feedback"])).toEqual([]);
    for (const bad of ["send_message", "Email_landlord", "auto_reply", "pay_deposit", "purchase"]) {
      expect(findForbiddenToolNames([bad])).toHaveLength(1);
    }
    expect(toolNames({ get_listing: {}, compare: { name: "compare" } })).toContain("get_listing");
    expect(toolNames([{ name: "send_it" }, { name: "ok" }])).toEqual(["send_it", "ok"]);
  });
});
