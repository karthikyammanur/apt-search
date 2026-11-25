// A post with no street address that names a neighbourhood, cross streets, a station or a city gets an
// approximate point, stored as an estimate. From that point a short commute passes and a longer one waits
// for the address.

import { describe, expect, it } from "vitest";
import { listings } from "@/db/schema";
import { checkCommute } from "@/lib/domain";
import { approximatePlace } from "@/lib/intake/approximate";
import { supostToRaw } from "@/lib/intake/channels/supost";
import { loadFacts } from "@/lib/intake/facts";
import { processRaw } from "@/lib/intake/pipeline";
import type { Extraction } from "@/lib/intake/schema";
import { cleanListing, f, settings as domainSettings } from "../domain/fixtures";
import { jsonFixture, makeDeps, settings, stubGeo } from "./helpers";

describe("approximatePlace: the place a post names", () => {
  it.each([
    { text: "Room near Cal Ave Caltrain, $1500", kind: "station", query: "California Avenue Caltrain Station, Palo Alto, CA", label: "near California Avenue Caltrain" },
    { text: "Sunny room close to the Menlo Park Caltrain, quiet", kind: "station", query: "Menlo Park Caltrain Station, CA", label: "near Menlo Park Caltrain" },
    { text: "Room at El Camino & Page Mill, Palo Alto", kind: "cross_streets", query: "El Camino & Page Mill, Palo Alto, CA", label: "near El Camino and Page Mill" },
    { text: "Long-term EVGR D Junior 2B2B sublease", kind: "landmark", query: "Escondido Village, Stanford, CA", label: "Escondido Village" },
    { text: "Room very close to Stanford campus (Palo Alto)", kind: "landmark", query: "Stanford University, Stanford, CA", label: "Stanford campus" },
    { text: "1B1B studio next to Stanford, 1m to EV", kind: "landmark", query: "Stanford University, Stanford, CA", label: "Stanford campus" },
    { text: "Quiet room in downtown Palo Alto", kind: "landmark", query: "University Avenue, Palo Alto, CA", label: "Downtown Palo Alto" },
    { text: "Room in 2B1B Apartment in Menlo Park from 12th December", kind: "city", query: "Menlo Park, CA", label: "Menlo Park" },
    { text: "Room in East Palo Alto", kind: "city", query: "East Palo Alto, CA", label: "East Palo Alto" },
  ])("$text gives $query", ({ text, kind, query, label }) => {
    expect(approximatePlace(text)).toEqual({ kind, query, label });
  });

  it("prefers cross streets over a station, a station over a neighbourhood, a neighbourhood over a city", () => {
    expect(approximatePlace("Room at Alma & Hamilton near Cal Ave Caltrain in Palo Alto")?.kind).toBe("cross_streets");
    expect(approximatePlace("Room near Cal Ave Caltrain, next to Stanford")?.kind).toBe("station");
    expect(approximatePlace("Room next to Stanford in Menlo Park")?.kind).toBe("landmark");
  });

  it("uses the city the post is known to be in when the text names none", () => {
    expect(approximatePlace("Furnished room, no pets", "Sunnyvale")).toMatchObject({ kind: "city", query: "Sunnyvale, CA" });
  });

  it.each([
    "Room with a private bathroom until December",
    "Rooms and Board available, cats and dogs welcome",
    "Cozy room, great light, $1000",
    "",
  ])("finds no place in: %s", (text) => {
    expect(approximatePlace(text)).toBeNull();
  });
});

describe("the commute from an approximate location", () => {
  const check = (minutes: number, approximate: boolean) =>
    checkCommute(
      cleanListing({ commuteMinutes: f(minutes, "api"), ...(approximate ? { locationApproximate: f(true, "estimate") } : {}) }),
      domainSettings,
    );

  it.each([
    { minutes: 12, status: "pass" },
    { minutes: 20, status: "pass" },
    { minutes: 21, status: "unknown" },
    { minutes: 28, status: "unknown" },
    { minutes: 45, status: "unknown" },
  ])("$minutes min is $status", ({ minutes, status }) => {
    expect(check(minutes, true).status).toBe(status);
  });

  it("says it is approximate and asks for the address", () => {
    const result = check(25, true);
    expect(result.reason).toBe("Approximate location, confirm the address");
    expect(result.questions).toEqual([expect.objectContaining({ field: "commuteMinutes", ask: "landlord", text: expect.stringContaining("exact address") })]);
  });

  it("a pass says the location is approximate", () => {
    expect(check(15, true).reason).toContain("approximate location");
  });

  it("never turns a long commute into a Fail from a guess", () => {
    expect(check(60, true).status).toBe("unknown");
    expect(check(60, false).status).toBe("fail");
  });

  it("an exact address is judged as before", () => {
    expect([12, 25, 30].map((m) => check(m, false).status)).toEqual(["pass", "pass", "pass"]);
  });

  it("follows a limit below 20 minutes", () => {
    const strict = { ...domainSettings, maxCommuteMinutes: 15 };
    const at = (m: number) => checkCommute(cleanListing({ commuteMinutes: f(m, "api"), locationApproximate: f(true, "estimate") }), strict).status;
    expect([15, 16].map(at)).toEqual(["pass", "unknown"]);
  });
});

type Post = { label: string; title: string; price: number; created_at: string; reply: Extraction; bucket: string; place?: string };
const { posts } = jsonFixture<{ posts: Post[] }>("supost-run-2026-11-24.json");

describe("the SUPost fixtures, end to end", () => {
  it.each(posts.map((post, index) => ({ ...post, index })))("$label", async (post) => {
    const raw = supostToRaw({ id: post.index + 1, title: post.title, price: post.price, created_at: post.created_at, url: `https://example.test/supost/${post.index + 1}`, stanford_verified: false });
    if (!raw) throw new Error("fixture did not convert");
    const ctx = await makeDeps([{ match: post.title, value: post.reply }]);
    const outcome = await processRaw(ctx.deps, raw);
    const id = outcome.listingId as number;
    const facts = await loadFacts(ctx.db, id);
    const [row] = await ctx.db.select().from(listings);
    // Posts that fail on dates or lease are never enriched, so their place is not looked up.
    if (post.bucket === "fail") {
      expect(facts.locationApproximate).toBeNull();
      expect(row?.lat).toBeNull();
      return;
    }
    if (post.place) {
      expect(ctx.calls.geocode).toContain(post.place);
      expect(facts.locationApproximate).toMatchObject({ value: true, provenance: "estimate" });
      expect(facts.locationApproximate?.note).toMatch(/^Approximate location: /);
      expect(row?.lat).not.toBeNull();
      expect(row?.address).toBeNull();
      expect(facts.commuteMinutes).toMatchObject({ value: 24, provenance: "api" });
      // The stub routes 24 minutes: past 20, so the commute waits for the address.
      expect(checkCommute(facts, settings)).toMatchObject({ status: "unknown", reason: "Approximate location, confirm the address" });
    } else {
      expect(facts.locationApproximate).toBeNull();
      expect(ctx.calls.transit).toBe(0);
    }
  });

  it("a 15 minute route from an approximate point passes the commute filter", async () => {
    const post = posts.find((p) => p.place)!;
    const raw = supostToRaw({ id: 99, title: post.title, price: post.price, created_at: post.created_at, url: "https://example.test/supost/99", stanford_verified: false })!;
    const ctx = await makeDeps([{ match: post.title, value: post.reply }]);
    ctx.deps.geo = { ...stubGeo().geo, transit: async () => ({ ok: true as const, data: { minutes: 15, steps: [{ mode: "TRANSIT", lineName: "Bus", minutes: 15 }] } }) };
    const outcome = await processRaw(ctx.deps, raw);
    const facts = await loadFacts(ctx.db, outcome.listingId as number);
    expect(checkCommute(facts, settings).status).toBe("pass");
  });
});
