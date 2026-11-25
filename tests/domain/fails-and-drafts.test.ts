// Display formats, how failed listings are grouped, and the short list of questions for the landlord.

import { describe, expect, it } from "vitest";
import {
  draftMessage,
  draftQuestions,
  fmtDay,
  fmtDayRange,
  fmtDollars,
  hiddenSummary,
  isNearMiss,
  MAX_DRAFT_QUESTIONS,
  NEAR_MISS_CENTS,
  overBudgetCents,
  overLabel,
  splitFails,
  tidyText,
  type FilterResult,
} from "@/lib/domain";
import { settings } from "./fixtures";

describe("money and dates for display", () => {
  it.each([
    [165000, "$1,650"],
    [165050, "$1,651"],
    [165049, "$1,650"],
    [0, "$0"],
    [100000000, "$1,000,000"],
    [-8000, "-$80"],
    [null, "Unknown"],
    [undefined, "Unknown"],
  ])("%s is %s", (cents, text) => {
    expect(fmtDollars(cents)).toBe(text);
  });

  it("writes a day without the year, and a range with both ends", () => {
    expect(fmtDay("2027-01-02")).toBe("Jan 2");
    expect(fmtDayRange("2027-01-02", "2027-08-13")).toBe("Jan 2 to Aug 13");
    expect(fmtDayRange("2027-01-02", null)).toBe("From Jan 2");
    expect(fmtDayRange(undefined, "2027-08-13")).toBe("Until Aug 13");
    expect(fmtDayRange(null, undefined)).toBeNull();
  });

  it("drops cents and years from a sentence", () => {
    expect(tidyText("$1,650.00 a month, at or under $2,500.00")).toBe("$1,650 a month, at or under $2,500");
    expect(tidyText("Sublet ends Jan 1, 2027, before move-out on Aug 13, 2027")).toBe("Sublet ends Jan 1, before move-out on Aug 13");
    expect(tidyText("about $1,234.56 and 12.50 minutes")).toBe("about $1,235 and 12.50 minutes");
  });
});

describe("near misses", () => {
  const cap = 250000;
  it("is how far over the cap, from the all-in total or else the confirmed floor", () => {
    expect(overBudgetCents({ allInMonthlyCents: 258000, confirmedFloorCents: 100000 }, cap)).toBe(8000);
    expect(overBudgetCents({ allInMonthlyCents: null, confirmedFloorCents: 262000 }, cap)).toBe(12000);
    expect(overBudgetCents({ allInMonthlyCents: 250000, confirmedFloorCents: 100000 }, cap)).toBeNull();
    expect(overBudgetCents({ allInMonthlyCents: 240000, confirmedFloorCents: 100000 }, cap)).toBeNull();
  });

  it("is a failure on budget alone, by $150 or less", () => {
    expect(NEAR_MISS_CENTS).toBe(15000);
    expect(isNearMiss({ failedFilters: ["budget"], overBudgetCents: 8000 })).toBe(true);
    expect(isNearMiss({ failedFilters: ["budget"], overBudgetCents: 15000 })).toBe(true);
    expect(isNearMiss({ failedFilters: ["budget"], overBudgetCents: 15001 })).toBe(false);
    expect(isNearMiss({ failedFilters: ["budget", "move_in"], overBudgetCents: 8000 })).toBe(false);
    expect(isNearMiss({ failedFilters: ["move_in"], overBudgetCents: null })).toBe(false);
  });

  it("groups them, nearest first, and leaves the rest in order", () => {
    const rows = [
      { id: 1, failedFilters: ["lease"] as const, overBudgetCents: null },
      { id: 2, failedFilters: ["budget"] as const, overBudgetCents: 12000 },
      { id: 3, failedFilters: ["budget"] as const, overBudgetCents: 8000 },
      { id: 4, failedFilters: ["budget"] as const, overBudgetCents: 40000 },
      { id: 5, failedFilters: ["budget", "commute"] as const, overBudgetCents: 3000 },
    ];
    const { nearMisses, others } = splitFails(rows);
    expect(nearMisses.map((r) => r.id)).toEqual([3, 2]);
    expect(others.map((r) => r.id)).toEqual([1, 4, 5]);
  });

  it("labels a row '$80 over'", () => {
    expect(overLabel(8000)).toBe("$80 over");
  });
});

describe("the hidden-fails summary", () => {
  it("names one reason plainly", () => {
    expect(hiddenSummary([{ failedFilters: ["budget"] }, { failedFilters: ["budget"] }, { failedFilters: ["budget", "lease"] }, { failedFilters: ["budget"] }])).toBe("4 hidden: over budget");
  });

  it("counts several reasons, most common first, by the first requirement failed", () => {
    expect(hiddenSummary([{ failedFilters: ["lease"] }, { failedFilters: ["budget"] }, { failedFilters: ["budget"] }, { failedFilters: ["move_in"] }, { failedFilters: ["budget"] }])).toBe(
      "5 hidden: 3 over budget, 1 lease does not fit, 1 wrong move-in dates",
    );
  });

  it("is null when nothing is hidden", () => {
    expect(hiddenSummary([])).toBeNull();
  });
});

describe("questions for the landlord", () => {
  const unknown = (filter: FilterResult["filter"], ...fields: string[]): FilterResult => ({
    filter,
    status: "unknown",
    reason: "Unknown",
    questions: fields.map((field) => ({ field, ask: "landlord", text: "long text" })),
  });
  const pass = (filter: FilterResult["filter"]): FilterResult => ({ filter, status: "pass", reason: "ok", questions: [] });
  const fail = (filter: FilterResult["filter"]): FilterResult => ({ filter, status: "fail", reason: "no", questions: [] });

  it("asks only about what is Unknown, with the dates from the settings", () => {
    const questions = draftQuestions([unknown("move_in", "availableFrom"), pass("budget"), unknown("lease", "leaseEnd")], settings);
    expect(questions).toEqual(["Can I move in between Jan 2 and Jan 8?", "Can I stay until Aug 13? What are the lease terms?"]);
  });

  it("asks nothing when every requirement is settled", () => {
    expect(draftQuestions([pass("move_in"), pass("lease"), pass("budget")], settings)).toEqual([]);
    expect(draftMessage([])).toBeNull();
  });

  it("asks nothing when the listing already fails", () => {
    expect(draftQuestions([fail("lease"), unknown("move_in", "availableFrom")], settings)).toEqual([]);
  });

  it("asks at most four, the ones that matter most first", () => {
    const results = [
      unknown("roommates", "hasRoommates"),
      unknown("furnished", "furnished"),
      unknown("private_bed_bath", "privateBedroom", "privateBath"),
      unknown("budget", "mandatoryFeesMonthlyCents"),
      unknown("commute", "commuteMinutes"),
      unknown("lease", "leaseEnd"),
      unknown("move_in", "availableFrom"),
    ];
    const questions = draftQuestions(results, settings, ["Utilities", "Internet"]);
    expect(MAX_DRAFT_QUESTIONS).toBe(4);
    expect(questions).toHaveLength(4);
    expect(questions[0]).toContain("move in between");
    expect(questions[1]).toContain("stay until");
    expect(questions[2]).toBe("What is the exact address, or the nearest cross streets?");
    expect(questions[3]).toBe("Besides rent, is there a charge for utilities, internet?");
  });

  it("asks about the bedroom or the bathroom, whichever is Unknown", () => {
    expect(draftQuestions([unknown("private_bed_bath", "privateBath")], settings)).toEqual(["Is the bathroom private?"]);
    expect(draftQuestions([unknown("private_bed_bath", "privateBedroom", "privateBath")], settings)).toEqual(["Are the bedroom and bathroom private?"]);
  });

  it("does not ask the landlord what only I can do", () => {
    const mine: FilterResult = { filter: "commute", status: "unknown", reason: "x", questions: [{ field: "commuteMinutes", ask: "me", text: "check it" }] };
    expect(draftQuestions([mine], settings)).toEqual([]);
  });

  it("writes one short message", () => {
    expect(draftMessage(["A?", "B?"])).toBe("Hi! I'm interested in this listing. A? B?");
  });
});
