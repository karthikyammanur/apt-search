// Lease analysis shared by the lease filter, the break-fee cost line and the lease fit score.
// Accepts a lease that fits the stay: a fixed lease of the stay's length (7 to 8 months by
// default), month-to-month, a sublet that runs to move-out, or a longer lease with a written
// break or sublet clause.

import { leaseMonthsBetween } from "./dates";
import { fmtDate } from "./format";
import { acceptableLeaseMonths, type Stay } from "./stay";
import type { ListingFacts, Question, Settings } from "./types";

export type LeaseAnalysis = {
  status: "pass" | "fail" | "unknown";
  reason: string;
  questions: Question[];
  /** How I get out at move-out when the lease runs longer. Null unless it passes. */
  exit: "none_needed" | "sublet_clause" | "break_clause" | null;
  /** Whether a break fee belongs in the cost. "possible" means the lease terms are still Unknown. */
  breakFee: "not_applicable" | "possible" | "applies";
};

export function analyzeLease(facts: ListingFacts, settings: Settings, stay: Stay): LeaseAnalysis {
  const moveOut = fmtDate(settings.moveOut);
  const termQuestion: Question = {
    field: "leaseType",
    ask: "landlord",
    text: `What lease terms do you offer? I need a lease from ${fmtDate(settings.moveInLatest)} or earlier until ${moveOut}.`,
  };
  const exitQuestion: Question = {
    field: "exitClause",
    ask: "landlord",
    text: `The lease runs past ${moveOut}. Is there a written break or sublet clause, and what is the break fee?`,
  };

  const type = facts.leaseType?.value;
  if (type === undefined) {
    return {
      status: "unknown",
      reason: "Lease type is Unknown",
      questions: [termQuestion],
      exit: null,
      breakFee: "possible",
    };
  }
  if (type === "month_to_month") {
    return { status: "pass", reason: "Month-to-month lease", questions: [], exit: "none_needed", breakFee: "not_applicable" };
  }
  if (type === "sublet") {
    const end = facts.leaseEnd?.value;
    if (end === undefined) {
      return {
        status: "unknown",
        reason: "Sublet end date is Unknown",
        questions: [{ field: "leaseEnd", ask: "landlord", text: `When does the sublet end? I need it until ${moveOut}.` }],
        exit: null,
        breakFee: "not_applicable",
      };
    }
    return end >= settings.moveOut
      ? { status: "pass", reason: `Sublet runs to ${fmtDate(end)}`, questions: [], exit: "none_needed", breakFee: "not_applicable" }
      : { status: "fail", reason: `Sublet ends ${fmtDate(end)}, before move-out on ${moveOut}`, questions: [], exit: null, breakFee: "not_applicable" };
  }

  // A fixed lease that ends before move-out cannot cover the stay, whatever its length.
  const end = facts.leaseEnd?.value;
  if (end !== undefined && end < settings.moveOut) {
    return {
      status: "fail",
      reason: `Lease ends ${fmtDate(end)}, before move-out on ${moveOut}`,
      questions: [],
      exit: null,
      breakFee: "not_applicable",
    };
  }

  // A stated length wins. Otherwise a stated start and end give it, so there is nothing to ask.
  const stated = facts.leaseMonths?.value;
  const start = facts.availableFrom?.value;
  const derived =
    stated === undefined && start !== undefined && end !== undefined ? leaseMonthsBetween(start, end) : null;
  const months = stated ?? derived ?? undefined;
  if (months === undefined) {
    return {
      status: "unknown",
      reason: "Lease length is Unknown",
      questions: [{ field: "leaseMonths", ask: "landlord", text: "How many months is the lease?" }],
      exit: null,
      breakFee: "possible",
    };
  }
  const lease = stated === undefined ? `${months}-month lease (from its dates)` : `${months}-month lease`;
  const fit = acceptableLeaseMonths(stay);
  if (fit === null) {
    return { status: "unknown", reason: "Stay dates are invalid", questions: [], exit: null, breakFee: "possible" };
  }
  if (months < fit.min) {
    return {
      status: "fail",
      reason: `${lease} is shorter than the ${fit.min} to ${fit.max} months I need`,
      questions: [],
      exit: null,
      breakFee: "not_applicable",
    };
  }
  if (months <= fit.max) {
    return { status: "pass", reason: `${lease} fits the stay`, questions: [], exit: "none_needed", breakFee: "not_applicable" };
  }

  const clause = facts.exitClause?.value;
  const longer = `${lease} runs past move-out`;
  if (clause === undefined) {
    return { status: "unknown", reason: `${longer}; break or sublet clause is Unknown`, questions: [exitQuestion], exit: null, breakFee: "possible" };
  }
  if (clause === "none") {
    return { status: "fail", reason: `${longer} with no break or sublet clause`, questions: [], exit: null, breakFee: "not_applicable" };
  }
  if (clause === "sublet") {
    return { status: "pass", reason: `${longer}; written sublet clause`, questions: [], exit: "sublet_clause", breakFee: "not_applicable" };
  }
  return { status: "pass", reason: `${longer}; written break clause (fee counts toward the cap)`, questions: [], exit: "break_clause", breakFee: "applies" };
}
