import { describe, expect, it } from "vitest";
import { checkLease, unknownListing, type ListingFacts } from "@/lib/domain";
import { leaseMonthsBetween } from "@/lib/domain/dates";
import { settings as BASE_SETTINGS } from "./fixtures";

describe("leaseMonthsBetween: inclusive dates, whole months, 15 or more leftover days round up", () => {
  it.each([
    { start: "2027-01-01", end: "2027-08-31", months: 8, why: "exactly 8 calendar months" },
    { start: "2027-01-04", end: "2027-08-03", months: 7, why: "exactly 7 months from the 4th" },
    { start: "2027-01-04", end: "2027-08-10", months: 7, why: "7 months and 7 days" },
    { start: "2027-01-04", end: "2027-08-17", months: 7, why: "14 leftover days stay down" },
    { start: "2027-01-04", end: "2027-08-18", months: 8, why: "15 leftover days round up" },
    { start: "2027-01-15", end: "2027-08-31", months: 8, why: "7 months and 17 days" },
    { start: "2027-01-31", end: "2027-02-27", months: 1, why: "a start on the 31st, February is short" },
    { start: "2027-01-31", end: "2027-03-30", months: 2, why: "steps to Feb 28 then Mar 31" },
    { start: "2028-01-31", end: "2028-02-28", months: 1, why: "leap year: Jan 31 plus a month is Feb 29" },
    { start: "2028-02-29", end: "2029-02-27", months: 12, why: "leap day start, a year later" },
    { start: "2026-12-01", end: "2027-11-30", months: 12, why: "across a year end" },
    { start: "2027-01-01", end: "2027-01-31", months: 1, why: "one whole month" },
    { start: "2027-01-01", end: "2027-01-14", months: null, why: "under a month after rounding" },
    { start: "2027-01-01", end: "2027-01-15", months: 1, why: "15 days rounds up to 1" },
    { start: "2027-01-01", end: "2027-01-01", months: null, why: "a single day" },
    { start: "2027-08-31", end: "2027-01-01", months: null, why: "end before start" },
    { start: "2027-02-30", end: "2027-08-31", months: null, why: "invalid start" },
    { start: "2027-01-01", end: "not a date", months: null, why: "invalid end" },
  ])("$start to $end is $months ($why)", ({ start, end, months }) => {
    expect(leaseMonthsBetween(start, end)).toBe(months);
  });
});

function fixedLease(facts: Partial<{ availableFrom: string; leaseEnd: string; leaseMonths: number }>): ListingFacts {
  const out = unknownListing();
  out.leaseType = { value: "fixed", provenance: "listing" };
  if (facts.availableFrom) out.availableFrom = { value: facts.availableFrom, provenance: "listing" };
  if (facts.leaseEnd) out.leaseEnd = { value: facts.leaseEnd, provenance: "listing" };
  if (facts.leaseMonths) out.leaseMonths = { value: facts.leaseMonths, provenance: "listing" };
  return out;
}

describe("a fixed lease with a stated start and end", () => {
  it("derives its length instead of asking", () => {
    const result = checkLease(fixedLease({ availableFrom: "2027-01-04", leaseEnd: "2027-08-31" }), BASE_SETTINGS);
    expect(result.status).toBe("pass");
    expect(result.reason).toBe("8-month lease (from its dates) fits the stay");
    expect(result.questions).toEqual([]);
  });

  it("still asks when only one date is known", () => {
    const result = checkLease(fixedLease({ leaseEnd: "2027-08-31" }), BASE_SETTINGS);
    expect(result).toMatchObject({ status: "unknown", reason: "Lease length is Unknown" });
  });

  it("prefers a stated length over the dates", () => {
    const result = checkLease(fixedLease({ availableFrom: "2027-01-04", leaseEnd: "2027-12-31", leaseMonths: 8 }), BASE_SETTINGS);
    expect(result.reason).toBe("8-month lease fits the stay");
  });

  it("a derived length past the stay needs a break or sublet clause", () => {
    const result = checkLease(fixedLease({ availableFrom: "2027-01-01", leaseEnd: "2027-12-31" }), BASE_SETTINGS);
    expect(result).toMatchObject({ status: "unknown", reason: "12-month lease (from its dates) runs past move-out; break or sublet clause is Unknown" });
  });

  it("fails when it ends before move-out, even with a length that would fit", () => {
    const result = checkLease(fixedLease({ availableFrom: "2027-01-01", leaseEnd: "2027-07-31", leaseMonths: 7 }), BASE_SETTINGS);
    expect(result.status).toBe("fail");
    expect(result.reason).toMatch(/^Lease ends Jul 31, 2027, before move-out on /);
  });
});
