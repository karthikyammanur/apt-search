// A commute a free routing provider gave, within 5 minutes of the limit, is Unknown, not Pass or Fail.

import { describe, expect, it } from "vitest";
import { checkCommute, COMMUTE_MARGIN_MINUTES, computeCost, routedByNote, runHardFilters, type Fact } from "@/lib/domain";
import { bayAreaPack } from "@/lib/regions";
import { cleanListing, f, settings } from "./fixtures";

const REASON = "Commute close to the limit, check it on Google Maps";
const freeCommute = (minutes: number): Fact<number> => ({ value: minutes, provenance: "api", note: routedByNote("transitland") });
const check = (commute: Fact<number> | null) => checkCommute(cleanListing({ commuteMinutes: commute }), settings);

describe("commute from a free provider", () => {
  it("has a margin of 5 minutes around the 30 minute limit", () => {
    expect(COMMUTE_MARGIN_MINUTES).toBe(5);
    expect(settings.maxCommuteMinutes).toBe(30);
  });

  it.each([
    { minutes: 20, status: "pass" },
    { minutes: 24, status: "pass" },
    { minutes: 25, status: "unknown" },
    { minutes: 28, status: "unknown" },
    { minutes: 30, status: "unknown" },
    { minutes: 32, status: "unknown" },
    { minutes: 35, status: "unknown" },
    { minutes: 36, status: "fail" },
    { minutes: 50, status: "fail" },
  ])("$minutes min is $status", ({ minutes, status }) => {
    expect(check(freeCommute(minutes)).status).toBe(status);
  });

  it("explains why, and asks me to check it", () => {
    const result = check(freeCommute(27));
    expect(result.reason).toBe(REASON);
    expect(result.questions).toEqual([
      expect.objectContaining({ field: "commuteMinutes", ask: "me", text: expect.stringContaining("Google Maps") }),
    ]);
  });

  it("follows the limit in the settings, not a fixed 30", () => {
    const strict = { ...settings, maxCommuteMinutes: 20 };
    const at = (minutes: number) => checkCommute(cleanListing({ commuteMinutes: freeCommute(minutes) }), strict).status;
    expect([14, 15, 20, 25, 26].map(at)).toEqual(["pass", "unknown", "unknown", "unknown", "fail"]);
  });

  it("puts the listing in Needs info, because an Unknown is not a Fail", () => {
    const listing = cleanListing({ commuteMinutes: freeCommute(29) });
    const outcome = runHardFilters(listing, settings, computeCost(listing, settings, bayAreaPack));
    expect(outcome.results.find((r) => r.filter === "commute")?.status).toBe("unknown");
    expect(outcome.bucket).toBe("needs_info");
  });
});

describe("commute from anywhere else", () => {
  it.each([30, 33, 36])("Google's answer (no note) at %i min decides as before", (minutes) => {
    expect(check(f(minutes, "api")).status).toBe(minutes <= 30 ? "pass" : "fail");
  });

  it("a commute I gave is trusted, even if the stored note says a provider routed it", () => {
    expect(check({ value: 28, provenance: "me", note: routedByNote("transitland") }).status).toBe("pass");
  });

  it("an unknown provider is not treated as free", () => {
    expect(check({ value: 28, provenance: "api", note: "Routed by Somebody" }).status).toBe("pass");
  });

  it("a missing commute is still Unknown", () => {
    expect(check(null)).toMatchObject({ status: "unknown", reason: "Commute is Unknown" });
  });
});

describe("routedByNote", () => {
  it("names the provider, and writes nothing when there is none", () => {
    expect(routedByNote("transitland")).toBe("Routed by Transitland");
    expect(routedByNote(undefined)).toBeNull();
  });
});
