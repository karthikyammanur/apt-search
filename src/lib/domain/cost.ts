// True monthly cost model (docs/requirements.md "True monthly cost model").
//
//   all-in monthly = rent + recurring costs + one-time non-refundable costs / months of stay
//
// Months of stay = days from move-in to move-out / 30.4375. Every amount stays an exact fraction
// until the very end, then rounds half up to whole cents. A missing recurring cost the region
// pack can estimate becomes an Estimated line; anything else missing is Unknown and makes the
// total Unknown. Unknown is never counted as 0.

import type { PassChoice, RegionAmount, RegionPack } from "@/lib/regions/types";
import { fmtCents, fmtDate } from "./format";
import { analyzeLease } from "./lease";
import {
  RAT_ZERO,
  ratDiv,
  ratInt,
  ratIsZero,
  ratMul,
  ratSum,
  roundHalfUp,
  type Rat,
} from "./rational";
import { DAYS_PER_MONTH, stayPeriod, type Stay } from "./stay";
import { isEstimate, type Fact, type ListingFacts, type Question, type Settings } from "./types";

export type LineStatus = "confirmed" | "estimated" | "unknown";

export type CostLineKey =
  | "rent"
  | "short_term_premium"
  | "mandatory_fees"
  | "utilities"
  | "internet"
  | "renters_insurance"
  | "one_time_fees"
  | "nonrefundable_deposit"
  | "break_fee"
  | "setup_items";

export type CostLine = {
  key: CostLineKey;
  label: string;
  kind: "recurring" | "one_time";
  status: LineStatus;
  /** Recurring: per month. One-time: the total. Rounded half up for display. Null when Unknown. */
  amountCents: number | null;
  /** What this line adds to the all-in monthly cost, rounded half up for display. */
  monthlyCents: number | null;
  /** Provenance of the fact (listing, landlord, me, api, estimate), or "region estimate". */
  source: string | null;
  sourceUrl: string | null;
  asOf: string | null;
  note: string | null;
  /** What to ask to confirm or fill in this line. Null for confirmed lines. */
  question: Question | null;
};

export type TransitPassCost =
  | { status: "estimated"; monthlyCents: number; detail: string; sources: string[] }
  | { status: "unknown"; reason: string };

export type CostResult = {
  stay: Stay;
  lines: CostLine[];
  /** Housing only, the number checked against the cap. Null when any line is Unknown. */
  allInMonthlyCents: number | null;
  /** Confirmed lines only. Unknown and estimated lines are at least 0, so this is a floor. */
  confirmedFloorCents: number;
  /** Confirmed plus estimated lines, leaving out Unknown ones. Also a floor. */
  estimatedFloorCents: number;
  transitPass: TransitPassCost;
  allInPlusTransitCents: number | null;
  /** Refundable deposit plus everything due at signing. Null when any part is Unknown. */
  upfrontCashCents: number | null;
  upfrontLines: { label: string; amountCents: number | null }[];
  /** All-in is at or under the cap, but at least one line in it is an estimate. */
  passesOnEstimatesOnly: boolean;
  estimatedLabels: string[];
  /** Questions for every Unknown or Estimated line. */
  questions: Question[];
};

type Draft = Omit<CostLine, "amountCents" | "monthlyCents"> & {
  amount: Rat | null;
  monthly: Rat | null;
};

function statusOf(fact: Fact<unknown>): LineStatus {
  return isEstimate(fact) ? "estimated" : "confirmed";
}

function fromFact(
  key: CostLineKey,
  label: string,
  kind: CostLine["kind"],
  fact: Fact<number> | null,
  question: Question,
  note: string | null = null,
): Draft {
  if (fact === null) {
    return { key, label, kind, status: "unknown", amount: null, monthly: null, source: null, sourceUrl: null, asOf: null, note, question };
  }
  const status = statusOf(fact);
  return {
    key,
    label,
    kind,
    status,
    amount: ratInt(fact.value),
    monthly: null,
    source: fact.provenance,
    sourceUrl: fact.sourceUrl ?? null,
    asOf: null,
    note,
    question: status === "confirmed" ? null : question,
  };
}

function included(key: CostLineKey, label: string, fact: Fact<boolean>, note: string): Draft {
  const status = statusOf(fact);
  return {
    key,
    label,
    kind: "recurring",
    status,
    amount: RAT_ZERO,
    monthly: null,
    source: fact.provenance,
    sourceUrl: fact.sourceUrl ?? null,
    asOf: null,
    note,
    question: null,
  };
}

function fromRegion(key: CostLineKey, label: string, estimate: RegionAmount, question: Question, note: string | null): Draft {
  if (estimate.status === "unknown") {
    return { key, label, kind: "recurring", status: "unknown", amount: null, monthly: null, source: null, sourceUrl: null, asOf: null, note: estimate.reason, question };
  }
  return {
    key,
    label,
    kind: "recurring",
    status: "estimated",
    amount: estimate.monthlyCents,
    monthly: null,
    source: "region estimate",
    sourceUrl: estimate.source.url,
    asOf: estimate.source.asOf,
    note: [note, estimate.note].filter(Boolean).join(". "),
    question,
  };
}

/** One-time amount / months of stay = amount * 16 / (487 * days). */
function spread(amount: Rat | null, stay: Stay): Rat | null {
  if (amount === null) return null;
  if (ratIsZero(amount)) return RAT_ZERO;
  if (stay.days === null) return null;
  return ratDiv(ratMul(amount, ratInt(DAYS_PER_MONTH.n)), ratInt(DAYS_PER_MONTH.d * stay.days));
}

function transitPassCost(choice: PassChoice | null): TransitPassCost {
  if (choice === null) return { status: "unknown", reason: "Commute route is Unknown" };
  if (choice.status === "unknown") return { status: "unknown", reason: choice.reason };
  return {
    status: "estimated",
    monthlyCents: choice.monthlyCents,
    detail: choice.reason,
    sources: [...new Set(choice.passes.map((pass) => pass.source.url))],
  };
}

export function computeCost(facts: ListingFacts, settings: Settings, region: RegionPack): CostResult {
  const stay = stayPeriod(facts, settings);
  const lease = analyzeLease(facts, settings, stay);
  const moveOut = fmtDate(settings.moveOut);
  const ask = (field: string, text: string): Question => ({ field, ask: "landlord", text });
  const drafts: Draft[] = [];

  // Recurring lines.
  drafts.push(fromFact("rent", "Base rent", "recurring", facts.rentCents, ask("rentCents", "What is the monthly rent?")));
  drafts.push(
    fromFact(
      "short_term_premium",
      "Short-term lease premium",
      "recurring",
      facts.shortTermPremiumCents,
      ask("shortTermPremiumCents", `Is there any extra monthly charge for a short lease ending ${moveOut}?`),
    ),
  );
  drafts.push(
    fromFact(
      "mandatory_fees",
      "Mandatory monthly fees",
      "recurring",
      facts.mandatoryFeesMonthlyCents,
      ask(
        "mandatoryFeesMonthlyCents",
        "Are there any required monthly fees on top of rent (amenity, admin, valet trash, parking)? How much?",
      ),
    ),
  );

  const utilitiesQuestion = ask(
    "utilitiesIncluded",
    "Are utilities (electric, gas, water, sewer, trash) included in rent? If not, about how much is my share per month?",
  );
  if (facts.utilitiesIncluded?.value === true) {
    drafts.push(included("utilities", "Utilities", facts.utilitiesIncluded, "Included in rent"));
  } else if (facts.utilitiesMyShareCents !== null) {
    drafts.push(fromFact("utilities", "Utilities", "recurring", facts.utilitiesMyShareCents, utilitiesQuestion));
  } else {
    const estimate = region.utilitiesMonthly({
      city: facts.city?.value ?? null,
      householdSize: facts.householdSize?.value ?? null,
    });
    const note = facts.utilitiesIncluded === null ? "Assumed not included" : "Not included";
    drafts.push(fromRegion("utilities", "Utilities", estimate, utilitiesQuestion, note));
  }

  const internetQuestion = ask("internetIncluded", "Is internet included? If not, what does it cost per month?");
  if (facts.internetIncluded?.value === true) {
    drafts.push(included("internet", "Internet", facts.internetIncluded, "Included in rent"));
  } else if (facts.internetMonthlyCents !== null) {
    drafts.push(fromFact("internet", "Internet", "recurring", facts.internetMonthlyCents, internetQuestion));
  } else {
    const note = facts.internetIncluded === null ? "Assumed not included" : "Not included";
    drafts.push(fromRegion("internet", "Internet", region.internetMonthly(), internetQuestion, note));
  }

  const insuranceQuestion = ask("rentersInsuranceRequired", "Does the lease require renter's insurance?");
  if (facts.rentersInsuranceRequired?.value !== false) {
    if (facts.rentersInsuranceMonthlyCents !== null) {
      drafts.push(fromFact("renters_insurance", "Renter's insurance", "recurring", facts.rentersInsuranceMonthlyCents, insuranceQuestion));
    } else {
      const note =
        facts.rentersInsuranceRequired === null
          ? "Assumed required until the landlord says otherwise"
          : "Required by the lease";
      drafts.push(fromRegion("renters_insurance", "Renter's insurance", region.rentersInsuranceMonthly(), insuranceQuestion, note));
    }
  }

  // One-time lines, spread over the stay.
  drafts.push(
    fromFact(
      "one_time_fees",
      "Application, admin, holding and broker fees",
      "one_time",
      facts.oneTimeFeesCents,
      ask("oneTimeFeesCents", "Are there any one-time fees (application, admin, holding or broker)? How much in total?"),
    ),
  );
  drafts.push(
    fromFact(
      "nonrefundable_deposit",
      "Non-refundable deposit",
      "one_time",
      facts.nonRefundableDepositCents,
      ask("nonRefundableDepositCents", "Is any part of the deposit non-refundable? If so, how much?"),
    ),
  );
  if (lease.breakFee !== "not_applicable") {
    const question =
      lease.breakFee === "possible"
        ? lease.questions[0] ?? ask("exitClause", "What lease terms do you offer?")
        : ask("breakFeeCents", `What is the fee to break the lease at ${moveOut}?`);
    const note = lease.breakFee === "possible" ? "Applies if the lease runs past move-out" : "Written break clause";
    // While the lease terms are Unknown, a stated fee is not enough to settle the line.
    const fact = lease.breakFee === "applies" ? facts.breakFeeCents : null;
    drafts.push(fromFact("break_fee", "Lease break fee", "one_time", fact, question, note));
  }
  if (facts.lacksBasics?.value !== false) {
    const question =
      facts.lacksBasics === null
        ? ask("lacksBasics", "Are bedding, towels and kitchen basics (pots, plates, utensils) provided?")
        : { field: "setupItemsCents", ask: "me" as const, text: "Price the bedding, towels and kitchen basics this place lacks." };
    const fact = facts.lacksBasics === null ? null : facts.setupItemsCents;
    drafts.push(fromFact("setup_items", "Setup items the place lacks", "one_time", fact, question));
  }

  for (const draft of drafts) {
    draft.monthly = draft.kind === "recurring" ? draft.amount : spread(draft.amount, stay);
    if (draft.monthly === null && draft.status !== "unknown") draft.status = "unknown";
  }

  const known = drafts.filter((d): d is Draft & { monthly: Rat } => d.monthly !== null);
  const allInExact = known.length === drafts.length ? ratSum(known.map((d) => d.monthly)) : null;
  const floor = (statuses: LineStatus[]) =>
    roundHalfUp(ratSum(known.filter((d) => statuses.includes(d.status)).map((d) => d.monthly)));
  const allInMonthlyCents = allInExact === null ? null : roundHalfUp(allInExact);

  const routeFact = facts.commuteRoute;
  const transitPass = transitPassCost(routeFact === null ? null : region.cheapestPass(routeFact.value));
  const allInPlusTransitCents =
    allInExact !== null && transitPass.status === "estimated"
      ? roundHalfUp(ratSum([allInExact, ratInt(transitPass.monthlyCents)]))
      : null;

  const upfrontParts: { label: string; fact: Fact<number> | null }[] = [
    { label: "Refundable security deposit", fact: facts.refundableDepositCents },
    { label: "First month's rent", fact: facts.rentCents },
    { label: "First month's short-term premium", fact: facts.shortTermPremiumCents },
    { label: "First month's mandatory fees", fact: facts.mandatoryFeesMonthlyCents },
    { label: "One-time fees", fact: facts.oneTimeFeesCents },
    { label: "Non-refundable deposit", fact: facts.nonRefundableDepositCents },
  ];
  const upfrontLines = upfrontParts.map((part) => ({ label: part.label, amountCents: part.fact?.value ?? null }));
  const upfrontCashCents = upfrontLines.every((line) => line.amountCents !== null)
    ? upfrontLines.reduce((sum, line) => sum + (line.amountCents ?? 0), 0)
    : null;

  const estimated = known.filter((d) => d.status === "estimated" && !ratIsZero(d.monthly));
  const passesOnEstimatesOnly =
    allInMonthlyCents !== null && allInMonthlyCents <= settings.budgetCapCents && estimated.length > 0;

  const lines: CostLine[] = drafts.map(({ amount, monthly, ...rest }) => ({
    ...rest,
    amountCents: amount === null ? null : roundHalfUp(amount),
    monthlyCents: monthly === null ? null : roundHalfUp(monthly),
  }));

  return {
    stay,
    lines,
    allInMonthlyCents,
    confirmedFloorCents: floor(["confirmed"]),
    estimatedFloorCents: floor(["confirmed", "estimated"]),
    transitPass,
    allInPlusTransitCents,
    upfrontCashCents,
    upfrontLines,
    passesOnEstimatesOnly,
    estimatedLabels: estimated.map((d) => d.label.toLowerCase()),
    questions: lines.flatMap((line) => (line.question ? [line.question] : [])),
  };
}

/** One-line summary for cards: "$2,180.00 a month all-in" or "at least $2,050.00 (Unknown: ...)". */
export function describeCost(cost: CostResult): string {
  if (cost.allInMonthlyCents !== null) return `${fmtCents(cost.allInMonthlyCents)} a month all-in`;
  const unknown = cost.lines.filter((line) => line.status === "unknown").map((line) => line.label.toLowerCase());
  return `At least ${fmtCents(cost.estimatedFloorCents)} a month (Unknown: ${unknown.join(", ")})`;
}
