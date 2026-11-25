// A SUPost post is saved with its description and photo links, and the detail is asked for only
// when the post is new.

import { describe, expect, it, vi } from "vitest";
import { photos } from "@/db/schema";
import { supostToRaw } from "@/lib/intake/channels/supost";
import { processRaw } from "@/lib/intake/pipeline";
import type { Result } from "@/lib/providers/core";
import type { SupostDetail } from "@/lib/providers/supost";
import { makeDeps } from "./helpers";

const item = {
  id: 100000001,
  title: "Sublease one bedroom at EVGR",
  price: 2110,
  created_at: "2026-11-24T00:00:00Z",
  url: "https://supost.com/post/sample-sublease-100000001",
  stanford_verified: true,
};
const PHOTOS = ["https://cdn.supost.com/v2/posts/a/1.jpg", "https://cdn.supost.com/v2/posts/b/2.jpg"];

type Detail = (id: number) => Promise<Result<SupostDetail>>;
function clientWith(detail: Detail) {
  return { listings: async () => ({ ok: false as const, error: "disabled" as const }), detail };
}
const found = () => vi.fn<Detail>(async () => ({ ok: true, data: { description: "Furnished private bedroom with a desk. Wifi included.", photoUrls: PHOTOS } }));

describe("SUPost detail in the pipeline", () => {
  it("shows the model the description, and stores the photo links in order", async () => {
    const ctx = await makeDeps([{ match: "Sublease one bedroom", value: { post_type: "room_offered", type: "room" } }]);
    const detail = found();
    const outcome = await processRaw(ctx.deps, supostToRaw(item, clientWith(detail))!);
    expect(outcome.status).toBe("stored");
    expect(ctx.prompts.some((p) => p.includes("Furnished private bedroom with a desk"))).toBe(true);
    const rows = await ctx.db.select().from(photos);
    expect(rows.map((r) => [r.url, r.position])).toEqual([[PHOTOS[0], 0], [PHOTOS[1], 1]]);
  });

  it("does not ask for the detail of a post that is already saved", async () => {
    const ctx = await makeDeps([{ match: "Sublease one bedroom", value: { post_type: "room_offered", type: "room" } }]);
    await processRaw(ctx.deps, supostToRaw(item, clientWith(found()))!);
    const detail = found();
    const again = await processRaw(ctx.deps, supostToRaw(item, clientWith(detail))!);
    expect(again.status).toBe("already_seen");
    expect(detail).not.toHaveBeenCalled();
  });

  it("stores the post from its title when the detail call fails", async () => {
    const ctx = await makeDeps([{ match: "Sublease one bedroom", value: { post_type: "room_offered", type: "room" } }]);
    const detail = vi.fn<Detail>(async () => ({ ok: false, error: "network" }));
    const outcome = await processRaw(ctx.deps, supostToRaw(item, clientWith(detail))!);
    expect(outcome.status).toBe("stored");
    expect(await ctx.db.select().from(photos)).toHaveLength(0);
  });

  it("stores the post when the detail call throws", async () => {
    const ctx = await makeDeps([{ match: "Sublease one bedroom", value: { post_type: "room_offered", type: "room" } }]);
    const detail = vi.fn<Detail>(async () => {
      throw new Error("boom");
    });
    const outcome = await processRaw(ctx.deps, supostToRaw(item, clientWith(detail))!);
    expect(outcome.status).toBe("stored");
  });
});
