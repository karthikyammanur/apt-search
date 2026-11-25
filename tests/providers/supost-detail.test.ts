// SUPost's listings API returns a title, a price, a date and a link: no description and no photos.
// Both come from SUPost's own agent server, one call per new post (a recorded answer is used here).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "@/db";
import { runMigrations } from "@/db/run-migrations";
import { createCachedFetch } from "@/lib/providers/core";
import { createSupost, plainText } from "@/lib/providers/supost";
import { supostToRaw } from "@/lib/intake/channels/supost";

const recorded = readFileSync(path.join(process.cwd(), "tests", "fixtures", "providers", "supost-detail.json"), "utf8");
const event = (json: string) => `event: message\ndata: ${json.replace(/\s*\n\s*/g, " ")}\n\n`;

async function harness(reply: { body: string; status?: number }) {
  const db = createDb(":memory:");
  await runMigrations(db);
  const network = vi.fn<typeof fetch>(async () => new Response(reply.body, { status: reply.status ?? 200, headers: { "content-type": "text/event-stream" } }));
  const transport = createCachedFetch({ db: () => db, fetch: network, now: () => Date.parse("2026-11-24T12:00:00Z") });
  return { network, client: createSupost({ transport }) };
}

describe("SUPost listing detail", () => {
  it("returns the description as plain text and the https photo links", async () => {
    const { client } = await harness({ body: event(recorded) });
    const result = await client.detail(100000001);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.description).toContain("EVGR Pub & Brewery");
    expect(result.data.description).not.toContain("&amp;");
    expect(result.data.photoUrls).toEqual([
      "https://cdn.supost.com/v2/posts/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000a1.jpg",
      "https://cdn.supost.com/v2/posts/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-0000000000a2.jpg",
    ]);
  });

  it("asks SUPost's agent server for that one listing, over POST", async () => {
    const { client, network } = await harness({ body: event(recorded) });
    await client.detail(100000001);
    const [url, init] = network.mock.calls[0]!;
    expect(url).toBe("https://mcp.supost.com/mcp");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ method: "tools/call", params: { name: "get_listing", arguments: { id: 100000001 } } });
    expect(new Headers(init?.headers).get("accept")).toContain("text/event-stream");
  });

  it("asks once in six hours, then answers from the cache", async () => {
    const { client, network } = await harness({ body: event(recorded) });
    await client.detail(100000001);
    await client.detail(100000001);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an error from the tool", event(JSON.stringify({ result: { isError: true, content: [{ type: "text", text: "not found" }] } }))],
    ["a reply that is not JSON inside", event(JSON.stringify({ result: { content: [{ type: "text", text: "plain words" }] } }))],
    ["no data line", "event: message\n\n"],
    ["an unexpected shape", event(JSON.stringify({ hello: "world" }))],
  ])("fails quietly on %s", async (_name, body) => {
    const { client } = await harness({ body });
    expect(await client.detail(1)).toMatchObject({ ok: false });
  });

  it("refuses an id that is not a positive whole number without calling out", async () => {
    const { client, network } = await harness({ body: event(recorded) });
    expect(await client.detail(0)).toEqual({ ok: false, error: "bad_response" });
    expect(await client.detail(1.5)).toEqual({ ok: false, error: "bad_response" });
    expect(network).not.toHaveBeenCalled();
  });
});

describe("plainText", () => {
  it("removes tags and decodes the common entities", () => {
    expect(plainText("Pub &amp; Brewery<br>&lt;b&gt; it&#39;s&nbsp;fine")).toBe("Pub & Brewery <b> it's fine");
  });
});

describe("the SUPost channel and the detail call", () => {
  const item = { id: 100000001, title: "A room", price: 1000, created_at: "2026-11-24T00:00:00Z", url: "https://supost.com/post/a-room-100000001", stanford_verified: true };

  it("leaves the raw post without detail when the client has no detail call", () => {
    expect(supostToRaw(item)?.detail).toBeUndefined();
  });

  it("gives the raw post a detail call that returns null on failure, and the data on success", async () => {
    const ok = supostToRaw(item, { listings: async () => ({ ok: false, error: "disabled" }), detail: async () => ({ ok: true, data: { description: "d", photoUrls: ["https://cdn.supost.com/a.jpg"] } }) });
    expect(await ok?.detail?.()).toEqual({ description: "d", photoUrls: ["https://cdn.supost.com/a.jpg"] });
    const failed = supostToRaw(item, { listings: async () => ({ ok: false, error: "disabled" }), detail: async () => ({ ok: false, error: "network" }) });
    expect(await failed?.detail?.()).toBeNull();
  });
});
