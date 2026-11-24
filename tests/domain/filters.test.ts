import { describe, expect, it } from "vitest";
import {
  checkCommute,
  checkFurnished,
  checkLease,
  checkMoveIn,
  checkPrivateBedBath,
  checkRoommates,
  checkScamChecks,
  checkTransitAccess,
  computeCost,
  runHardFilters,
  type ListingFacts,
} from "@/lib/domain";
import { bayAreaPack } from "@/lib/regions";
import { allScamChecksPass, cleanListing, f, settings } from "./fixtures";

const L = (overrides: Partial<ListingFacts> = {}) => cleanListing(overrides);

describe("the clean listing passes every filter", () => {
  it("lands in the pass bucket with no questions", () => {
    const listing = L();
    const report = runHardFilters(listing, settings, computeCost(listing, settings, bayAreaPack));
    expect(report.results.filter((r) => r.status !== "pass")).toEqual([]);
    expect(report.bucket).toBe("pass");
    expect(report.questions).toEqual([]);
  });
});

describe("move-in", () => {
  it.each([
    { from: "2027-01-08", status: "pass" },
    { from: "2026-12-15", status: "pass" },
    { from: "2027-01-09", status: "fail" },
    { from: null, status: "unknown" },
  ])("available $from is $status", ({ from, status }) => {
    const result = checkMoveIn(L({ availableFrom: from ? f(from) : null }), settings);
    expect(result.status).toBe(status);
    if (status === "unknown") expect(result.questions[0]?.text).toContain("Jan 2, 2027 and Jan 8, 2027");
  });
});

describe("lease fit", () => {
  it.each([
    { name: "7-month fixed", over: { leaseMonths: f(7) }, status: "pass" },
    { name: "8-month fixed", over: { leaseMonths: f(8) }, status: "pass" },
    { name: "6-month fixed", over: { leaseMonths: f(6) }, status: "fail" },
    { name: "month-to-month", over: { leaseType: f("month_to_month" as const), leaseMonths: null }, status: "pass" },
    { name: "sublet to Aug 13", over: { leaseType: f("sublet" as const), leaseEnd: f("2027-08-13") }, status: "pass" },
    { name: "sublet to Jul 31", over: { leaseType: f("sublet" as const), leaseEnd: f("2027-07-31") }, status: "fail" },
    { name: "sublet, end Unknown", over: { leaseType: f("sublet" as const) }, status: "unknown" },
    { name: "12-month with break clause", over: { leaseMonths: f(12), exitClause: f("break" as const) }, status: "pass" },
    { name: "12-month with sublet clause", over: { leaseMonths: f(12), exitClause: f("sublet" as const) }, status: "pass" },
    { name: "12-month, no clause", over: { leaseMonths: f(12), exitClause: f("none" as const) }, status: "fail" },
    { name: "12-month, clause Unknown", over: { leaseMonths: f(12) }, status: "unknown" },
    { name: "lease type Unknown", over: { leaseType: null }, status: "unknown" },
    { name: "length Unknown", over: { leaseMonths: null }, status: "unknown" },
  ])("$name is $status", ({ over, status }) => {
    const result = checkLease(L(over), settings);
    expect(result.status).toBe(status);
    expect(result.questions.length > 0).toBe(status === "unknown");
  });
});

describe("commute", () => {
  it.each([
    { minutes: 30, status: "pass" },
    { minutes: 31, status: "fail" },
    { minutes: null, status: "unknown" },
  ])("$minutes min is $status", ({ minutes, status }) => {
    expect(checkCommute(L({ commuteMinutes: minutes === null ? null : f(minutes, "api") }), settings).status).toBe(status);
  });
});

describe("transit access", () => {
  const stop = (walkMinutes: number, rushHeadwayMinutes: number | null) => ({ walkMinutes, rushHeadwayMinutes, regionalRail: false });
  it.each([
    { name: "10 min walk, every 30 min", stops: [stop(10, 30)], status: "pass" },
    { name: "11 min walk", stops: [stop(11, 10)], status: "fail" },
    { name: "every 31 min", stops: [stop(5, 31)], status: "fail" },
    { name: "a far frequent stop and a near slow one", stops: [stop(12, 10), stop(4, 45)], status: "fail" },
    { name: "a near stop with Unknown frequency", stops: [stop(4, null)], status: "unknown" },
    { name: "no stops", stops: [], status: "fail" },
    { name: "stops Unknown", stops: null, status: "unknown" },
  ])("$name is $status", ({ stops, status }) => {
    expect(checkTransitAccess(L({ nearbyStops: stops === null ? null : f(stops, "api") })).status).toBe(status);
  });
});

describe("private bedroom and bath", () => {
  it.each([
    { name: "both private", over: {}, status: "pass" },
    { name: "shared bath", over: { privateBath: f(false) }, status: "fail" },
    { name: "bath Unknown", over: { privateBath: null }, status: "unknown" },
    { name: "studio with nothing stated", over: { type: f("studio" as const), privateBedroom: null, privateBath: null }, status: "pass" },
    { name: "studio that says shared bath", over: { type: f("studio" as const), privateBath: f(false) }, status: "fail" },
  ])("$name is $status", ({ over, status }) => {
    expect(checkPrivateBedBath(L(over), settings).status).toBe(status);
  });

  it("does not check the bath when the setting is off", () => {
    expect(checkPrivateBedBath(L({ privateBath: f(false) }), { ...settings, requirePrivateBath: false }).status).toBe("pass");
  });
});

describe("furnished", () => {
  it.each([
    { name: "fully furnished", over: {}, status: "pass" },
    { name: "unfurnished", over: { furnished: f(false) }, status: "fail" },
    { name: "no desk", over: { hasDesk: f(false) }, status: "fail" },
    { name: "kitchen Unknown", over: { kitchenEquipped: null }, status: "unknown" },
  ])("$name is $status", ({ over, status }) => {
    expect(checkFurnished(L(over), settings).status).toBe(status);
  });
});

describe("scam checks", () => {
  it.each([
    { name: "all pass", checks: allScamChecksPass, status: "pass" },
    { name: "one fail", checks: { ...allScamChecksPass, no_live_video_tour: "fail" as const }, status: "fail" },
    { name: "a fail that was resolved", checks: { ...allScamChecksPass, pressure_to_pay_fast: "resolved" as const }, status: "pass" },
    { name: "one not checked", checks: { ...allScamChecksPass, photos_reused: null }, status: "unknown" },
    { name: "none checked", checks: null, status: "unknown" },
  ])("$name is $status", ({ checks, status }) => {
    expect(checkScamChecks(L({ scamChecks: checks === null ? null : f(checks, "me") })).status).toBe(status);
  });

  it("asks only about the open checks", () => {
    const result = checkScamChecks(L({ scamChecks: f({ ...allScamChecksPass, photos_reused: null }, "me") }));
    expect(result.questions).toEqual([{ field: "scam.photos_reused", ask: "me", text: "Run a Google Lens check on the listing photos." }]);
  });
});

describe("roommates", () => {
  it.each([
    { name: "can meet them", over: {}, status: "pass" },
    { name: "cannot meet them", over: { canMeetRoommates: f(false) }, status: "fail" },
    { name: "Unknown if I can meet them", over: { canMeetRoommates: null }, status: "unknown" },
    { name: "whole studio, no roommates", over: { type: f("studio" as const), hasRoommates: null, canMeetRoommates: null }, status: "pass" },
    { name: "type and roommates Unknown", over: { type: null, hasRoommates: null }, status: "unknown" },
  ])("$name is $status", ({ over, status }) => {
    expect(checkRoommates(L(over)).status).toBe(status);
  });
});

describe("buckets", () => {
  const bucket = (over: Partial<ListingFacts>) => {
    const listing = L(over);
    return runHardFilters(listing, settings, computeCost(listing, settings, bayAreaPack));
  };

  it("any Fail drops the listing even when others are Unknown", () => {
    expect(bucket({ commuteMinutes: f(45, "api"), rentCents: null }).bucket).toBe("fail");
  });

  it("Unknown without a Fail is Needs info, with each question once", () => {
    const report = bucket({ rentCents: null, privateBath: null, availableFrom: null });
    expect(report.bucket).toBe("needs_info");
    expect(report.questions.map((q) => q.field)).toEqual(["rentCents", "availableFrom", "privateBath"]);
  });
});

describe("the likely bucket", () => {
  const CAP = settings.budgetCapCents;
  const run = (over: Partial<ListingFacts>) => {
    const listing = L(over);
    return runHardFilters(listing, settings, computeCost(listing, settings, bayAreaPack));
  };
  // Rent is the only known cost line; the fee lines are Unknown.
  const feesUnknown = { mandatoryFeesMonthlyCents: null, oneTimeFeesCents: null };

  it.each([
    { name: "$150.00 under the cap", rent: CAP - 15000, bucket: "likely" },
    { name: "$149.99 under the cap", rent: CAP - 14999, bucket: "needs_info" },
    { name: "$151 under the cap", rent: CAP - 15100, bucket: "likely" },
    { name: "$1 under the cap", rent: CAP - 100, bucket: "needs_info" },
    { name: "at the cap", rent: CAP, bucket: "needs_info" },
    { name: "$0.01 over the cap", rent: CAP + 1, bucket: "fail" },
  ])("known costs $name give $bucket", ({ rent, bucket }) => {
    expect(run({ ...feesUnknown, rentCents: f(rent) }).bucket).toBe(bucket);
  });

  it("carries the reason, keeps the fee questions, and is never a confirmed pass", () => {
    const report = run({ ...feesUnknown, rentCents: f(200000) });
    expect(report.bucket).toBe("likely");
    expect(report.bucket).not.toBe("pass");
    expect(report.likelyReason).toBe("confirm fees with landlord");
    expect(report.questions.map((q) => q.field)).toEqual(
      expect.arrayContaining(["mandatoryFeesMonthlyCents", "oneTimeFeesCents"]),
    );
  });

  it("counts setup items as an allowed Unknown line", () => {
    expect(run({ ...feesUnknown, lacksBasics: null, rentCents: f(200000) }).bucket).toBe("likely");
  });

  it.each([
    { name: "the non-refundable deposit", over: { nonRefundableDepositCents: null } },
    { name: "the short-term premium", over: { shortTermPremiumCents: null } },
    { name: "the rent", over: { rentCents: null } },
  ])("an Unknown $name keeps it in needs_info", ({ over }) => {
    expect(run({ ...feesUnknown, rentCents: f(200000), ...over }).bucket).toBe("needs_info");
  });

  it("estimated lines count as known costs", () => {
    // Utilities not stated: the region estimate is added to rent and can close the $150 gap.
    const report = run({ ...feesUnknown, rentCents: f(CAP - 15000), utilitiesIncluded: null });
    expect(report.bucket).toBe("needs_info");
  });

  it("stays needs_info when another filter is Unknown", () => {
    expect(run({ ...feesUnknown, rentCents: f(200000), privateBath: null }).bucket).toBe("needs_info");
  });

  it("a failed filter still drops it", () => {
    expect(run({ ...feesUnknown, rentCents: f(200000), commuteMinutes: f(45, "api") }).bucket).toBe("fail");
  });

  it("open scam checks do not block it, a failed one does", () => {
    expect(run({ ...feesUnknown, rentCents: f(200000), scamChecks: null }).bucket).toBe("likely");
    const failed = { ...allScamChecksPass, untraceable_payment_before_lease: "fail" as const };
    expect(run({ ...feesUnknown, rentCents: f(200000), scamChecks: f(failed, "estimate") }).bucket).toBe("fail");
  });

  it("a fully known listing is still a plain pass", () => {
    expect(run({ rentCents: f(CAP - 15000) }).bucket).toBe("pass");
  });
});
