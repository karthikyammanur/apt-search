// Channel adapters and the runner. The Gmail path uses the real Gmail provider client with a
// recording transport, so the test can see every URL the code would ask for.

import { afterEach, describe, expect, it, vi } from "vitest";
import { channelRuns, listings, photos } from "@/db/schema";
import { collectGmail } from "@/lib/intake/channels/gmail";
import { collectRentcast, rentcastToRaw } from "@/lib/intake/channels/rentcast";
import { runAutomaticChannels, processBatch } from "@/lib/intake/run";
import { createGmail, type Transport } from "@/lib/providers";
import { FIXTURE_REPLIES, HOME, OFFICE, emailFixture, jsonFixture, makeDeps, readFixture } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const EMAIL_IDS = ["msg-craigslist-1", "msg-zillow-1", "msg-facebook-1"];

/** A transport that serves the three fixture emails and records every URL it is asked for. */
function gmailTransport() {
  const requested: string[] = [];
  const transport: Transport = async (_provider, request) => {
    requested.push(request.url);
    const url = new URL(request.url);
    let data: unknown;
    if (url.hostname === "oauth2.googleapis.com") {
      data = { access_token: "t", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.readonly" };
    } else if (url.pathname.endsWith("/messages")) {
      data = { messages: EMAIL_IDS.map((id) => ({ id: id.replace(/-/g, "_") })) };
    } else {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/_/g, "-");
      const email = emailFixture(id);
      data = {
        id: email.id,
        payload: {
          mimeType: "text/html",
          headers: email.headers,
          body: { data: Buffer.from(email.html ?? "", "utf8").toString("base64url") },
        },
      };
    }
    const parsed = request.schema.safeParse(data);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "bad_response" };
  };
  const gmail = createGmail({ transport, clientId: "id", clientSecret: "secret", refreshToken: "refresh" });
  return { gmail, requested };
}

describe("no link in an email is ever fetched", () => {
  it("reads three alert emails through the provider and asks only Gmail's own hosts for anything", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network is off in tests"));
    const { gmail, requested } = gmailTransport();
    const { deps, db, calls } = await makeDeps(FIXTURE_REPLIES);

    const collected = await collectGmail(gmail, "2026-11-20T00:00:00Z");
    expect(collected.error).toBeNull();
    expect(collected.items).toHaveLength(4); // 1 craigslist, 2 zillow, 1 facebook
    const { outcomes } = await processBatch(deps, collected.items, 20);
    expect(outcomes.map((o) => o.status)).toEqual(["stored", "stored", "stored", "stored"]);

    // Every request went to Gmail or Google's OAuth host. None went to a listing, photo or footer link.
    expect(requested.length).toBeGreaterThan(3);
    for (const url of requested) {
      expect(["oauth2.googleapis.com", "gmail.googleapis.com"]).toContain(new URL(url).hostname);
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    // The map services were given addresses, never an email link.
    expect(calls.geocode.join(" ")).not.toMatch(/https?:/);

    // The links survive as data: listing links on the listing, image links as photos.
    const rows = await db.select().from(listings);
    expect(rows.map((r) => r.url).filter(Boolean)).toContain("https://www.zillow.com/homedetails/410-Oak-St-Menlo-Park-CA-94025/19543_zpid/");
    const photoUrls = (await db.select().from(photos)).map((p) => p.url);
    expect(photoUrls).toContain("https://images.craigslist.org/00a0a_abc123_600x450.jpg");
  });

  it("lists the housing-alerts label and nothing else", async () => {
    const { gmail, requested } = gmailTransport();
    await collectGmail(gmail, "2026-11-20T00:00:00Z");
    const listUrl = requested.find((u) => u.endsWith("/messages") || u.includes("/messages?"));
    expect(decodeURIComponent(listUrl ?? "")).toContain("label:housing-alerts");
  });

  it("is skipped, not failed, when Gmail has no credentials", async () => {
    const gmail = createGmail({ transport: async () => ({ ok: false, error: "network" }), clientId: "", clientSecret: "", refreshToken: "" });
    const collected = await collectGmail(gmail, "2026-11-20T00:00:00Z");
    expect(collected).toMatchObject({ items: [], error: null });
    expect(collected.skipped).toBeTruthy();
  });
});

describe("RentCast adapter", () => {
  const item = {
    id: "rc-1",
    formattedAddress: "55 Test Way, Menlo Park, CA 94025",
    latitude: HOME.lat,
    longitude: HOME.lng,
    price: 2300,
    propertyType: "Apartment",
    bedrooms: 0,
    bathrooms: 1,
    city: "Menlo Park",
  };

  it("turns a record into a structured raw listing with no model", () => {
    const raw = rentcastToRaw(item);
    expect(raw).toMatchObject({
      source: "rentcast",
      url: "rentcast:rc-1",
      skipModel: true,
      prefill: { postType: "whole_place_offered", lat: HOME.lat, facts: { type: "studio", rentCents: 230000, city: "Menlo Park" } },
    });
  });

  it("is skipped when disabled, and an error when the search fails", async () => {
    expect((await collectRentcast({ listings: async () => ({ ok: false, error: "disabled" }) }, OFFICE)).skipped).toBeTruthy();
    expect((await collectRentcast({ listings: async () => ({ ok: false, error: "rate_limited" }) }, OFFICE)).error).toBe("rate_limited");
    expect((await collectRentcast({ listings: async () => ({ ok: true, data: [] }) }, null)).error).toContain("office");
  });

  it("runs end to end without calling the model or geocoding the listing", async () => {
    const { deps, db, prompts, calls } = await makeDeps(FIXTURE_REPLIES);
    const summaries = await runAutomaticChannels(deps, {
      channels: ["rentcast"],
      clients: { rentcast: { listings: async () => ({ ok: true, data: [item] }) } },
    });
    expect(summaries[0]).toMatchObject({ channel: "rentcast", seen: 1, newCount: 1, error: null });
    expect(prompts).toHaveLength(0);
    expect(calls.geocode).toEqual([deps.settings.officeAddress]);
    const [row] = await db.select().from(listings);
    expect(row).toMatchObject({ source: "rentcast", type: "studio", lat: HOME.lat });
    expect(summaries[0]?.outcomes[0]?.commuteMinutes).toBe(24);
  });

  it("does not search again within 6 days", async () => {
    const { deps } = await makeDeps(FIXTURE_REPLIES);
    const search = vi.fn(async () => ({ ok: true as const, data: [] }));
    await runAutomaticChannels(deps, { channels: ["rentcast"], clients: { rentcast: { listings: search } } });
    const again = await runAutomaticChannels(deps, { channels: ["rentcast"], clients: { rentcast: { listings: search } } });
    expect(search).toHaveBeenCalledTimes(1);
    expect(again[0]?.skipped).toContain("6 days");
    await runAutomaticChannels(deps, { channels: ["rentcast"], force: true, clients: { rentcast: { listings: search } } });
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe("the runner", () => {
  const supostClient = () => ({
    listings: async () => ({ ok: true as const, data: jsonFixture<{ listings: never[]; next_cursor: null }>("supost-item.json") }),
  });

  it("records one channel_runs row per channel with seen and new counts", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const { gmail } = gmailTransport();
    const summaries = await runAutomaticChannels(deps, {
      clients: { supost: supostClient(), gmail, rentcast: { listings: async () => ({ ok: false, error: "disabled" }) } },
    });
    expect(summaries.map((s) => [s.channel, s.seen, s.newCount, s.skipped])).toEqual([
      ["supost", 1, 1, null],
      ["gmail_alerts", 4, 4, null],
      ["rentcast", 0, 0, "RentCast is disabled (no key)"],
    ]);
    const runs = await db.select().from(channelRuns);
    expect(runs.map((r) => [r.channel, r.itemsSeen, r.itemsNew, r.error])).toEqual([
      ["supost", 1, 1, null],
      ["gmail_alerts", 4, 4, null],
    ]);
  });

  it("a second run finds nothing new and spends no model calls on what it has seen", async () => {
    const { deps, prompts } = await makeDeps(FIXTURE_REPLIES);
    const clients = { supost: supostClient() };
    await runAutomaticChannels(deps, { channels: ["supost"], clients });
    const calls = prompts.length;
    const again = await runAutomaticChannels(deps, { channels: ["supost"], clients });
    expect(again[0]).toMatchObject({ seen: 1, newCount: 0 });
    expect(again[0]?.outcomes[0]?.status).toBe("already_seen");
    expect(prompts).toHaveLength(calls);
  });

  it("stops at the per-run limit, defers the rest, and does not mark the run clean", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const { gmail } = gmailTransport();
    const [summary] = await runAutomaticChannels(deps, { channels: ["gmail_alerts"], limit: 2, clients: { gmail } });
    expect(summary).toMatchObject({ seen: 4, newCount: 2, deferred: 2 });
    const [run] = await db.select().from(channelRuns);
    expect(run?.error).toContain("deferred");
  });

  it("a failing channel is recorded with its error and does not stop the others", async () => {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    const down = { listings: async () => ({ ok: false as const, error: "network" as const }) };
    const summaries = await runAutomaticChannels(deps, {
      channels: ["supost", "rentcast"],
      clients: { supost: down, rentcast: { listings: async () => ({ ok: true, data: [] }) } },
    });
    expect(summaries[0]?.error).toContain("network");
    expect(summaries[1]?.error).toBeNull();
    const runs = await db.select().from(channelRuns);
    expect(runs.map((r) => r.channel)).toEqual(["supost", "rentcast"]);
    expect(runs[0]?.error).toContain("network");
  });
});

describe("fixtures stay neutral", () => {
  it("contain no real office or personal data", () => {
    for (const name of ["craigslist-alert.html", "zillow-alert.html", "facebook-notification.html"]) {
      expect(readFixture(name)).not.toMatch(/@gmail\.com|@(?!example)\w+\.edu/i);
    }
  });
});
