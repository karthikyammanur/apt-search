import { describe, expect, it } from "vitest";
import { channelRuns, listings, roommateLeads } from "@/db/schema";
import { captureSchema, captureToRaw, handleCapture, tokenMatches } from "@/lib/intake/capture";
import { FIXTURE_REPLIES, jsonFixture, makeDeps } from "./helpers";

const TOKEN = "test-capture-token-0123456789";

const call = async (
  body: unknown,
  token: string | null = TOKEN,
  // Boxed, so that an explicit undefined (no token configured) is not replaced by the default.
  expected: { value: string | undefined } = { value: TOKEN },
) => {
  const ctx = await makeDeps(FIXTURE_REPLIES);
  const response = await handleCapture({ token, expectedToken: expected.value, body }, async () => ctx.deps);
  return { response, ...ctx };
};

describe("the capture endpoint rejects a wrong token", () => {
  it.each([
    { name: "a wrong token", token: "nope-nope-nope-nope-nope", expected: { value: TOKEN } },
    { name: "a near miss", token: `${TOKEN}x`, expected: { value: TOKEN } },
    { name: "no token", token: null, expected: { value: TOKEN } },
    { name: "an empty token", token: "", expected: { value: TOKEN } },
    { name: "no token configured", token: TOKEN, expected: { value: undefined } },
    { name: "a blank configured token", token: "", expected: { value: "" } },
    { name: "a configured token that is too short", token: "short", expected: { value: "short" } },
  ])("$name gives 401 and stores nothing", async ({ token, expected }) => {
    const { response, db } = await call(jsonFixture("extension-page.json"), token, expected);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
    expect(await db.select().from(listings)).toHaveLength(0);
    expect(await db.select().from(channelRuns)).toHaveLength(0);
  });

  it("checks the token before the body, so a bad token learns nothing about the payload", async () => {
    const { response } = await call({ nonsense: true }, "wrong-wrong-wrong-wrong");
    expect(response.status).toBe(401);
  });

  it("compares the token exactly", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN.toUpperCase(), TOKEN)).toBe(false);
  });
});

describe("the capture endpoint rejects any other shape", () => {
  it.each([
    { name: "an empty object", body: {} },
    { name: "not an object", body: "text" },
    { name: "null", body: null },
    { name: "a page without text", body: { url: "https://x.example.test/a" } },
    { name: "a page with an extra field", body: { url: "https://x.example.test/a", text: "t", cmd: "rm" } },
    { name: "a javascript url", body: { url: "javascript:alert(1)", text: "t" } },
    { name: "a data url photo", body: { url: "https://x.example.test/a", text: "t", photoUrls: ["data:text/html,hi"] } },
    { name: "an empty batch", body: { posts: [] } },
    { name: "a post without a link", body: { posts: [{ text: "hi" }] } },
    { name: "a batch mixed with page fields", body: { url: "https://x.example.test/a", text: "t", posts: [] } },
  ])("$name gives 400", async ({ body }) => {
    const { response, db } = await call(body);
    expect(response.status).toBe(400);
    expect(await db.select().from(listings)).toHaveLength(0);
  });

  it("accepts the two documented shapes", () => {
    expect(captureSchema.safeParse(jsonFixture("extension-page.json")).success).toBe(true);
    expect(captureSchema.safeParse(jsonFixture("facebook-batch.json")).success).toBe(true);
  });
});

describe("a valid capture", () => {
  it("stores one page as an extension listing and records a channel run", async () => {
    const { response, db } = await call(jsonFixture("extension-page.json"));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, results: [{ status: "stored" }] });
    const [row] = await db.select().from(listings);
    expect(row?.source).toBe("furnishedfinder.com");
    expect(row?.url).toBe("https://www.furnishedfinder.com/property/000000_1");
    const [run] = await db.select().from(channelRuns);
    expect(run).toMatchObject({ channel: "extension", itemsSeen: 1, itemsNew: 1, error: null });
  });

  it("stores a Facebook batch: the offer as a listing, the roommate post as a lead", async () => {
    const { response, db } = await call(jsonFixture("facebook-batch.json"));
    expect(response.status).toBe(200);
    expect((response.body.results as { status: string }[]).map((r) => r.status)).toEqual(["stored", "roommate_lead"]);
    const [row] = await db.select().from(listings);
    expect(row).toMatchObject({
      source: "facebook_group",
      groupName: "Bay Area Furnished Rentals & Sublets",
      posterProfileUrl: "https://www.facebook.com/example.profile.1",
    });
    expect(await db.select().from(roommateLeads)).toHaveLength(1);
    const runs = await db.select().from(channelRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      channel: "facebook_capture",
      groupName: "Bay Area Furnished Rentals & Sublets",
      itemsSeen: 2,
      itemsNew: 2,
    });
  });

  it("keeps photo links as data and never downloads them", async () => {
    const raws = captureToRaw(captureSchema.parse(jsonFixture("extension-page.json")));
    expect(raws[0]?.photoUrls).toEqual(["https://images.example.test/rooms/1.jpg", "https://images.example.test/rooms/2.jpg"]);
  });
});
