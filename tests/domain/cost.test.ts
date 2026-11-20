import { describe, expect, it } from "vitest";
import { computeCost, checkBudget, runHardFilters, stayPeriod, acceptableLeaseMonths, describeCost } from "@/lib/domain";
import { bayAreaPack, getRegionPack } from "@/lib/regions";
import { cleanListing, f, settings } from "./fixtures";

const cost = (overrides: Parameters<typeof cleanListing>[0] = {}, region = bayAreaPack) =>
  computeCost(cleanListing(overrides), settings, region);
const line = (result: ReturnType<typeof cost>, key: string) => result.lines.find((l) => l.key === key);

describe("stay length", () => {
  it.each([
    { availableFrom: "2027-01-02", moveIn: "2027-01-02", days: 223, assumed: false },
    { availableFrom: "2026-12-01", moveIn: "2027-01-02", days: 223, assumed: false },
    { availableFrom: "2027-01-05", moveIn: "2027-01-05", days: 220, assumed: false },
    { availableFrom: null, moveIn: "2027-01-08", days: 217, assumed: true },
  ])("available $availableFrom moves in $moveIn for $days days", ({ availableFrom, moveIn, days, assumed }) => {
    const stay = stayPeriod(cleanListing({ availableFrom: availableFrom ? f(availableFrom) : null }), settings);
    expect(stay).toMatchObject({ moveIn, days, moveInAssumed: assumed });
    expect(stay.monthsApprox).toBeCloseTo(days / 30.4375, 12);
  });

  it("accepts 7 to 8 month leases for the default stay", () => {
    expect(acceptableLeaseMonths(stayPeriod(cleanListing(), settings))).toEqual({ min: 7, max: 8 });
  });
});

describe("$2,500 boundary", () => {
  // A $17.84 fee over 223 days is exactly 243.5 cents a month: 1784 * 487 / (16 * 223).
  it.each([
    { name: "$2,500.00 confirmed", rent: 250000, fee: 0, total: 250000, status: "pass" },
    { name: "$2,500.01 confirmed", rent: 250001, fee: 0, total: 250001, status: "fail" },
    { name: "$2,499.995 rounds half up to $2,500.00", rent: 249756, fee: 1784, total: 250000, status: "pass" },
    { name: "$2,500.005 rounds half up to $2,500.01", rent: 249757, fee: 1784, total: 250001, status: "fail" },
  ])("$name", ({ rent, fee, total, status }) => {
    const result = cost({ rentCents: f(rent), oneTimeFeesCents: f(fee) });
    expect(result.allInMonthlyCents).toBe(total);
    expect(checkBudget(result, settings).status).toBe(status);
  });

  it("rounds the total once, not line by line", () => {
    // Two lines of exactly 243.5 cents each. Rounded per line they would add to 488; exact is 487.
    const result = cost({ rentCents: f(100000), oneTimeFeesCents: f(1784), nonRefundableDepositCents: f(1784) });
    expect(line(result, "one_time_fees")?.monthlyCents).toBe(244);
    expect(line(result, "nonrefundable_deposit")?.monthlyCents).toBe(244);
    expect(result.allInMonthlyCents).toBe(100487);
  });
});

describe("Unknown stays Unknown", () => {
  it("Unknown rent gives an Unknown total and a Needs info result with the rent question", () => {
    const listing = cleanListing({ rentCents: null });
    const result = computeCost(listing, settings, bayAreaPack);
    expect(result.allInMonthlyCents).toBeNull();
    expect(result.allInPlusTransitCents).toBeNull();
    expect(result.upfrontCashCents).toBeNull();
    expect(line(result, "rent")?.status).toBe("unknown");
    const report = runHardFilters(listing, settings, result);
    expect(report.bucket).toBe("needs_info");
    expect(report.results.find((r) => r.filter === "budget")?.status).toBe("unknown");
    expect(report.questions.map((q) => q.text)).toContain("What is the monthly rent?");
  });

  it.each([
    { field: "mandatoryFeesMonthlyCents", key: "mandatory_fees" },
    { field: "shortTermPremiumCents", key: "short_term_premium" },
    { field: "oneTimeFeesCents", key: "one_time_fees" },
    { field: "nonRefundableDepositCents", key: "nonrefundable_deposit" },
    { field: "lacksBasics", key: "setup_items" },
  ] as const)("missing $field the pack cannot estimate makes the total Unknown", ({ field, key }) => {
    const result = cost({ [field]: null });
    expect(line(result, key)?.status).toBe("unknown");
    expect(result.allInMonthlyCents).toBeNull();
    expect(checkBudget(result, settings).status).toBe("unknown");
  });

  it("fails on confirmed costs alone even while other lines are Unknown", () => {
    const result = cost({ rentCents: f(260000), mandatoryFeesMonthlyCents: null });
    expect(result.allInMonthlyCents).toBeNull();
    expect(result.confirmedFloorCents).toBe(260000);
    expect(checkBudget(result, settings).status).toBe("fail");
  });

  it("a region without a pack leaves estimable lines Unknown", () => {
    const result = cost({ utilitiesIncluded: null }, getRegionPack("san-diego"));
    expect(line(result, "utilities")?.status).toBe("unknown");
    expect(result.allInMonthlyCents).toBeNull();
    expect(result.transitPass.status).toBe("unknown");
  });
});

describe("utilities", () => {
  it.each([
    { name: "included", over: { utilitiesIncluded: f(true) }, status: "confirmed", cents: 0 },
    { name: "my share stated", over: { utilitiesIncluded: f(false), utilitiesMyShareCents: f(9000) }, status: "confirmed", cents: 9000 },
    // Palo Alto median household bill $426.00 split 4 ways.
    { name: "estimated, split by household", over: { utilitiesIncluded: f(false) }, status: "estimated", cents: 10650 },
    // Unknown household: $426.00 / 2.55 = $167.0588...
    { name: "estimated, one person's share", over: { utilitiesIncluded: null, householdSize: null }, status: "estimated", cents: 16706 },
    // City not in the table: highest bill ($541.00) / 2.55 = $212.1568...
    { name: "estimated, unlisted city", over: { utilitiesIncluded: null, householdSize: null, city: f("Sunnyvale") }, status: "estimated", cents: 21216 },
  ])("$name", ({ over, status, cents }) => {
    const result = cost(over);
    expect(line(result, "utilities")).toMatchObject({ status, monthlyCents: cents });
    expect(result.allInMonthlyCents).toBe(200000 + cents);
  });

  it("flags a pass that rests on estimates and names what to confirm", () => {
    const result = cost({ utilitiesIncluded: null, internetIncluded: null, rentersInsuranceRequired: null });
    // 200000 + 10650 + 4500 + 1500
    expect(result.allInMonthlyCents).toBe(216650);
    expect(result.passesOnEstimatesOnly).toBe(true);
    expect(result.estimatedLabels).toEqual(["utilities", "internet", "renter's insurance"]);
    expect(checkBudget(result, settings).reason).toContain("Passes on estimates, confirm utilities, internet, renter's insurance with landlord.");
  });

  it("does not flag a fully confirmed pass", () => {
    expect(cost().passesOnEstimatesOnly).toBe(false);
  });

  it("is Needs info, not Fail, when only estimates push it over the cap", () => {
    const result = cost({ rentCents: f(245000), utilitiesIncluded: null, householdSize: null });
    expect(result.allInMonthlyCents).toBe(261706);
    expect(checkBudget(result, settings).status).toBe("unknown");
  });

  it("an estimate stored as a fact is shown as Estimated", () => {
    const result = cost({ utilitiesIncluded: f(false), utilitiesMyShareCents: f(12000, "estimate") });
    expect(line(result, "utilities")?.status).toBe("estimated");
  });
});

describe("one-time costs spread over the stay", () => {
  it.each([
    // 50000 * 487 / (16 * 223) = 6824.55
    { name: "$500 fee from Jan 2", over: { oneTimeFeesCents: f(50000) }, spread: 6825, total: 206825 },
    // Non-refundable deposit is spread the same way.
    { name: "$500 non-refundable deposit", over: { nonRefundableDepositCents: f(50000) }, spread: 6825, total: 206825 },
    // Unknown move-in uses Jan 8: 50000 * 487 / (16 * 217) = 7013.25
    { name: "$500 fee, move-in Unknown", over: { oneTimeFeesCents: f(50000), availableFrom: null }, spread: 7013, total: 207013 },
    { name: "setup items I priced", over: { lacksBasics: f(true), setupItemsCents: f(12000, "me") }, spread: 1638, total: 201638 },
  ])("$name", ({ over, spread, total }) => {
    const result = cost(over);
    const oneTime = result.lines.filter((l) => l.kind === "one_time" && l.monthlyCents);
    expect(oneTime.map((l) => l.monthlyCents)).toEqual([spread]);
    expect(result.allInMonthlyCents).toBe(total);
  });

  it("the refundable deposit is upfront cash, not monthly", () => {
    const result = cost({ refundableDepositCents: f(300000), oneTimeFeesCents: f(5000) });
    // 5000 * 487 / (16 * 223) = 682.40
    expect(result.allInMonthlyCents).toBe(200682);
    expect(result.upfrontCashCents).toBe(300000 + 200000 + 5000);
  });
});

describe("12-month lease with a break fee", () => {
  const twelve = { leaseMonths: f(12), exitClause: f("break" as const), breakFeeCents: f(100000) };

  it("spreads the break fee over the stay and counts it toward the cap", () => {
    const result = cost(twelve);
    // 100000 * 487 / (16 * 223) = 13649.10
    expect(line(result, "break_fee")).toMatchObject({ status: "confirmed", amountCents: 100000, monthlyCents: 13649 });
    expect(result.allInMonthlyCents).toBe(213649);
  });

  it("a break fee can push it over the cap", () => {
    const result = cost({ ...twelve, rentCents: f(240000) });
    expect(result.allInMonthlyCents).toBe(253649);
    expect(checkBudget(result, settings).status).toBe("fail");
  });

  it.each([
    { name: "break fee Unknown", over: { ...twelve, breakFeeCents: null }, status: "unknown" },
    { name: "exit clause Unknown", over: { leaseMonths: f(12), exitClause: null }, status: "unknown" },
    { name: "lease type Unknown", over: { leaseType: null, leaseMonths: null }, status: "unknown" },
  ])("$name leaves the break fee Unknown", ({ over, status }) => {
    const result = cost(over);
    expect(line(result, "break_fee")?.status).toBe(status);
    expect(result.allInMonthlyCents).toBeNull();
  });

  it.each([
    { name: "7-month lease", over: {} },
    { name: "month-to-month", over: { leaseType: f("month_to_month" as const), leaseMonths: null } },
    { name: "sublet clause", over: { leaseMonths: f(12), exitClause: f("sublet" as const) } },
  ])("$name has no break fee line", ({ over }) => {
    expect(line(cost(over), "break_fee")).toBeUndefined();
  });
});

describe("transit pass and housing plus transit", () => {
  it.each([
    { name: "Caltrain 1 zone", from: "Mountain View", to: "Palo Alto", pass: 9600 },
    { name: "Caltrain 2 zones", from: "Redwood City", to: "Palo Alto", pass: 15000 },
  ])("$name", ({ from, to, pass }) => {
    const result = cost({
      commuteRoute: f({ legs: [{ mode: "transit" as const, agency: "caltrain", from, to }] }, "api"),
    });
    expect(result.transitPass).toMatchObject({ status: "estimated", monthlyCents: pass });
    expect(result.allInPlusTransitCents).toBe(200000 + pass);
  });

  it("Unknown route leaves housing plus transit Unknown but housing known", () => {
    const result = cost({ commuteRoute: null });
    expect(result.allInMonthlyCents).toBe(200000);
    expect(result.allInPlusTransitCents).toBeNull();
  });

  it("describes a partly Unknown cost as a floor", () => {
    expect(describeCost(cost({ oneTimeFeesCents: null }))).toBe(
      "At least $2,000.00 a month (Unknown: application, admin, holding and broker fees)",
    );
    expect(describeCost(cost())).toBe("$2,000.00 a month all-in");
  });
});
