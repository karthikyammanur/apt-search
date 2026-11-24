// Hard filters: one function per dealbreaker in docs/requirements.md "Hard requirements".
// Each returns Pass, Fail or Unknown with a reason. Unknown also carries the exact questions
// to ask. Any Fail drops the listing; otherwise any Unknown puts it in Needs info.

import type { CostLineKey, CostResult } from "./cost";
import { fmtCents, fmtDate } from "./format";
import { analyzeLease } from "./lease";
import { stayPeriod } from "./stay";
import { SCAM_CHECK_IDS, type ListingFacts, type Question, type ScamCheckId, type Settings } from "./types";

export type FilterId =
  | "budget"
  | "move_in"
  | "lease"
  | "commute"
  | "transit_access"
  | "private_bed_bath"
  | "furnished"
  | "scam_checks"
  | "roommates";

export type FilterStatus = "pass" | "fail" | "unknown";

export type FilterResult = {
  filter: FilterId;
  status: FilterStatus;
  reason: string;
  /** Empty unless the status is Unknown. */
  questions: Question[];
};

/** Rule 5 defaults from the requirements: a stop within a 10 minute walk, every 30 minutes or better. */
export const TRANSIT_ACCESS_DEFAULTS = { maxWalkMinutes: 10, maxRushHeadwayMinutes: 30 } as const;
export type TransitAccessRule = { maxWalkMinutes: number; maxRushHeadwayMinutes: number };

const pass = (filter: FilterId, reason: string): FilterResult => ({ filter, status: "pass", reason, questions: [] });
const fail = (filter: FilterId, reason: string): FilterResult => ({ filter, status: "fail", reason, questions: [] });
const unknown = (filter: FilterId, reason: string, questions: Question[]): FilterResult => ({
  filter,
  status: "unknown",
  reason,
  questions,
});

/** 1. All-in monthly cost at or under the cap. $2,500.00 passes and $2,500.01 fails. */
export function checkBudget(cost: CostResult, settings: Settings): FilterResult {
  const cap = settings.budgetCapCents;
  if (cost.confirmedFloorCents > cap) {
    return fail("budget", `Confirmed costs alone are ${fmtCents(cost.confirmedFloorCents)} a month, over the ${fmtCents(cap)} cap`);
  }
  const estimatedQuestions = cost.lines.flatMap((l) => (l.status === "estimated" && l.question ? [l.question] : []));
  if (cost.allInMonthlyCents !== null) {
    const total = fmtCents(cost.allInMonthlyCents);
    if (cost.allInMonthlyCents <= cap) {
      return pass(
        "budget",
        cost.passesOnEstimatesOnly
          ? `${total} a month, at or under ${fmtCents(cap)}. Passes on estimates, confirm ${cost.estimatedLabels.join(", ")} with landlord.`
          : `${total} a month, at or under ${fmtCents(cap)}`,
      );
    }
    return unknown(
      "budget",
      `${total} a month is over ${fmtCents(cap)} only because of estimated ${cost.estimatedLabels.join(", ")}`,
      estimatedQuestions,
    );
  }
  const unknownLines = cost.lines.filter((l) => l.status === "unknown");
  const questions = unknownLines.flatMap((l) => (l.question ? [l.question] : []));
  if (cost.estimatedFloorCents > cap) questions.push(...estimatedQuestions);
  return unknown(
    "budget",
    `All-in cost is Unknown (missing: ${unknownLines.map((l) => l.label.toLowerCase()).join(", ")}). Known so far: at least ${fmtCents(cost.estimatedFloorCents)} a month`,
    questions,
  );
}

/** 2. Move-in by the latest date in my window. */
export function checkMoveIn(facts: ListingFacts, settings: Settings): FilterResult {
  const available = facts.availableFrom?.value;
  if (available === undefined) {
    return unknown("move_in", "Move-in date is Unknown", [
      {
        field: "availableFrom",
        ask: "landlord",
        text: `What is the earliest move-in date? I need to move in between ${fmtDate(settings.moveInEarliest)} and ${fmtDate(settings.moveInLatest)}.`,
      },
    ]);
  }
  return available <= settings.moveInLatest
    ? pass("move_in", `Available ${fmtDate(available)}, by ${fmtDate(settings.moveInLatest)}`)
    : fail("move_in", `Available ${fmtDate(available)}, after ${fmtDate(settings.moveInLatest)}`);
}

/** 3. Lease fits the stay. */
export function checkLease(facts: ListingFacts, settings: Settings): FilterResult {
  const lease = analyzeLease(facts, settings, stayPeriod(facts, settings));
  return { filter: "lease", status: lease.status, reason: lease.reason, questions: lease.questions };
}

/** 4. Commute without a car within my limit. */
export function checkCommute(facts: ListingFacts, settings: Settings): FilterResult {
  const minutes = facts.commuteMinutes?.value;
  if (minutes === undefined) {
    return unknown("commute", "Commute is Unknown", [
      { field: "commuteMinutes", ask: "landlord", text: "What is the exact address, or the nearest cross streets?" },
    ]);
  }
  return minutes <= settings.maxCommuteMinutes
    ? pass("commute", `${minutes} min door to office, within ${settings.maxCommuteMinutes} min`)
    : fail("commute", `${minutes} min door to office, over ${settings.maxCommuteMinutes} min`);
}

/** 5. A transit stop within a short walk with frequent rush-hour service. */
export function checkTransitAccess(facts: ListingFacts, rule: TransitAccessRule = TRANSIT_ACCESS_DEFAULTS): FilterResult {
  const question: Question = {
    field: "nearbyStops",
    ask: "landlord",
    text: `Which bus or train stops are within a ${rule.maxWalkMinutes} minute walk, and how often do they run on weekday mornings?`,
  };
  const stops = facts.nearbyStops?.value;
  if (stops === undefined) return unknown("transit_access", "Nearby stops are Unknown", [question]);
  const close = stops.filter((stop) => stop.walkMinutes <= rule.maxWalkMinutes);
  const good = close.find((stop) => stop.rushHeadwayMinutes !== null && stop.rushHeadwayMinutes <= rule.maxRushHeadwayMinutes);
  if (good) {
    return pass(
      "transit_access",
      `${good.name ?? "A stop"} is a ${good.walkMinutes} min walk, every ${good.rushHeadwayMinutes} min at rush hour`,
    );
  }
  if (close.some((stop) => stop.rushHeadwayMinutes === null)) {
    return unknown("transit_access", "Rush-hour frequency of the nearby stops is Unknown", [question]);
  }
  return fail(
    "transit_access",
    close.length === 0
      ? `No stop within a ${rule.maxWalkMinutes} min walk`
      : `No stop within a ${rule.maxWalkMinutes} min walk runs every ${rule.maxRushHeadwayMinutes} min or better at rush hour`,
  );
}

/** 6. Private bedroom and private bathroom. A whole studio or apartment counts as private. */
export function checkPrivateBedBath(facts: ListingFacts, settings: Settings): FilterResult {
  const whole = facts.type?.value === "studio" || facts.type?.value === "apartment";
  const checks = [
    { required: settings.requirePrivateBedroom, value: facts.privateBedroom?.value, name: "bedroom", field: "privateBedroom", text: "Is the bedroom private, not shared with anyone?" },
    { required: settings.requirePrivateBath, value: facts.privateBath?.value, name: "bathroom", field: "privateBath", text: "Is the bathroom private, used only by me?" },
  ].filter((check) => check.required);
  const resolved = checks.map((check) => ({ ...check, value: check.value ?? (whole ? true : undefined) }));
  const shared = resolved.filter((check) => check.value === false);
  if (shared.length > 0) return fail("private_bed_bath", `Shared ${shared.map((c) => c.name).join(" and ")}`);
  const missing = resolved.filter((check) => check.value === undefined);
  if (missing.length > 0) {
    return unknown(
      "private_bed_bath",
      `Private ${missing.map((c) => c.name).join(" and ")} is Unknown`,
      missing.map((c) => ({ field: c.field, ask: "landlord" as const, text: c.text })),
    );
  }
  return pass("private_bed_bath", whole && facts.privateBath === null ? "Whole unit, so bedroom and bath are private" : "Private bedroom and bathroom");
}

/** 7. Furnished with at least a bed, desk, chair and an equipped kitchen. */
export function checkFurnished(facts: ListingFacts, settings: Settings): FilterResult {
  if (!settings.requireFurnished) return pass("furnished", "Furnished is not required");
  const items = [
    { name: "furnished", value: facts.furnished?.value, field: "furnished", text: "Is it furnished?" },
    { name: "bed", value: facts.hasBed?.value, field: "hasBed", text: "Does it come with a bed?" },
    { name: "desk", value: facts.hasDesk?.value, field: "hasDesk", text: "Does it come with a desk?" },
    { name: "chair", value: facts.hasChair?.value, field: "hasChair", text: "Does it come with a desk chair?" },
    { name: "equipped kitchen", value: facts.kitchenEquipped?.value, field: "kitchenEquipped", text: "Is the kitchen equipped (stove, fridge, cookware)?" },
  ];
  const lacking = items.filter((item) => item.value === false);
  if (lacking.length > 0) return fail("furnished", `Not provided: ${lacking.map((i) => i.name).join(", ")}`);
  const missing = items.filter((item) => item.value === undefined);
  if (missing.length > 0) {
    return unknown(
      "furnished",
      `Unknown: ${missing.map((i) => i.name).join(", ")}`,
      missing.map((i) => ({ field: i.field, ask: "landlord" as const, text: i.text })),
    );
  }
  return pass("furnished", "Furnished with bed, desk, chair and an equipped kitchen");
}

const SCAM_QUESTIONS: Record<ScamCheckId, Question> = {
  price_far_below_market: { field: "scam.price_far_below_market", ask: "me", text: "Compare the rent with similar listings in the same area." },
  no_live_video_tour: { field: "scam.no_live_video_tour", ask: "landlord", text: "Can we do a live video tour before I sign or pay anything?" },
  untraceable_payment_before_lease: { field: "scam.untraceable_payment_before_lease", ask: "landlord", text: "How do you take the deposit and rent, and is anything due before a signed lease?" },
  overseas_landlord: { field: "scam.overseas_landlord", ask: "landlord", text: "Will you or a property manager hand over the keys in person?" },
  photos_reused: { field: "scam.photos_reused", ask: "me", text: "Run a Google Lens check on the listing photos." },
  pressure_to_pay_fast: { field: "scam.pressure_to_pay_fast", ask: "landlord", text: "Is a holding deposit required, and by when?" },
  not_owner_or_address_mismatch: { field: "scam.not_owner_or_address_mismatch", ask: "landlord", text: "Are you the owner or the property manager on record for this address?" },
};

/** 8. Every scam check passes, or a failed one has been resolved. */
export function checkScamChecks(facts: ListingFacts): FilterResult {
  const checks = facts.scamChecks?.value;
  const statuses = SCAM_CHECK_IDS.map((id) => ({ id, status: checks?.[id] ?? null }));
  const failed = statuses.filter((s) => s.status === "fail");
  if (failed.length > 0) return fail("scam_checks", `Failed scam checks: ${failed.map((s) => s.id).join(", ")}`);
  const open = statuses.filter((s) => s.status === null);
  if (open.length > 0) {
    return unknown(
      "scam_checks",
      `${open.length} of ${SCAM_CHECK_IDS.length} scam checks are Unknown`,
      open.map((s) => SCAM_QUESTIONS[s.id]),
    );
  }
  return pass("scam_checks", "All scam checks pass");
}

/** 9. Roommate listings only: I can message or video call the roommates before signing. */
export function checkRoommates(facts: ListingFacts): FilterResult {
  const type = facts.type?.value;
  const hasRoommates = facts.hasRoommates?.value ?? (type === "room" ? true : type === "studio" || type === "apartment" ? false : undefined);
  if (hasRoommates === false) return pass("roommates", "No roommates");
  if (hasRoommates === undefined) {
    return unknown("roommates", "Whether there are roommates is Unknown", [
      { field: "hasRoommates", ask: "landlord", text: "Does anyone else live there? If so, can I message or video call them before signing?" },
    ]);
  }
  const canMeet = facts.canMeetRoommates?.value;
  if (canMeet === undefined) {
    return unknown("roommates", "Whether I can meet the roommates first is Unknown", [
      { field: "canMeetRoommates", ask: "landlord", text: "Can I message or video call the people I would live with before signing?" },
    ]);
  }
  return canMeet
    ? pass("roommates", "I can talk to the roommates before signing")
    : fail("roommates", "No chance to talk to the roommates before signing");
}

/**
 * "likely" is a refinement of needs_info, never a confirmed pass: the known monthly costs sit
 * well under the cap and only fees are missing. It ranks with the scored listings.
 */
export type Bucket = "pass" | "fail" | "needs_info" | "likely";

/** Known monthly costs must be at least this far under the cap for a "likely" listing. */
export const LIKELY_MARGIN_CENTS = 15000;
export const LIKELY_REASON = "confirm fees with landlord";
/** Shown on a "likely" listing's card while any scam check is still open. */
export const SCAM_CHECKS_PENDING = "scam checks pending";
/** Cost lines that may be Unknown for a "likely" listing. */
const LIKELY_UNKNOWN_LINES: readonly CostLineKey[] = [
  "mandatory_fees",
  "one_time_fees",
  "setup_items",
  "nonrefundable_deposit",
];

export type HardFilterReport = {
  bucket: Bucket;
  results: FilterResult[];
  /** Questions from every Unknown filter, without duplicates. */
  questions: Question[];
  /** Set only when the bucket is "likely". */
  likelyReason?: string;
  /** Set only when the bucket is "likely" and a scam check is still open: "scam checks pending". */
  scamNote?: string;
};

/**
 * The listing states a term that covers my whole stay, so its price is already the price for
 * that term and no short-term premium applies: it is available by my latest move-in, and it is
 * a sublet running to move-out or a fixed lease whose length fits the stay. Month-to-month and
 * longer leases with an exit clause do not count, since either may still carry a premium.
 */
export function statedTermCoversStay(facts: ListingFacts, settings: Settings): boolean {
  const start = facts.availableFrom?.value;
  if (start === undefined || start > settings.moveInLatest) return false;
  const type = facts.leaseType?.value;
  if (type === "sublet") {
    const end = facts.leaseEnd?.value;
    return end !== undefined && end >= settings.moveOut;
  }
  if (type === "fixed") {
    const lease = analyzeLease(facts, settings, stayPeriod(facts, settings));
    return lease.status === "pass" && lease.exit === "none_needed";
  }
  return false;
}

/**
 * Known monthly costs (confirmed plus estimated lines) are at least $150 under the cap, and the
 * only Unknown cost lines are mandatory fees, one-time fees, setup items, the non-refundable
 * deposit, or the short-term premium when the stated term covers the stay. An Unknown line adds
 * nothing to the known floor, so that premium counts as 0 in the margin.
 */
export function isLikelyOnCost(cost: CostResult, settings: Settings, facts: ListingFacts): boolean {
  const premiumAllowed = statedTermCoversStay(facts, settings);
  const allowed = (key: CostLineKey) =>
    LIKELY_UNKNOWN_LINES.includes(key) || (key === "short_term_premium" && premiumAllowed);
  const unknownLines = cost.lines.filter((line) => line.status === "unknown");
  return (
    unknownLines.length > 0 &&
    unknownLines.every((line) => allowed(line.key)) &&
    cost.estimatedFloorCents <= settings.budgetCapCents - LIKELY_MARGIN_CENTS
  );
}

export function runHardFilters(
  facts: ListingFacts,
  settings: Settings,
  cost: CostResult,
  transitRule: TransitAccessRule = TRANSIT_ACCESS_DEFAULTS,
): HardFilterReport {
  const results = [
    checkBudget(cost, settings),
    checkMoveIn(facts, settings),
    checkLease(facts, settings),
    checkCommute(facts, settings),
    checkTransitAccess(facts, transitRule),
    checkPrivateBedBath(facts, settings),
    checkFurnished(facts, settings),
    checkScamChecks(facts),
    checkRoommates(facts),
  ];
  let bucket: Bucket = results.some((r) => r.status === "fail")
    ? "fail"
    : results.some((r) => r.status === "unknown")
      ? "needs_info"
      : "pass";
  // Likely: the budget is Unknown only because of fees, and every other filter passes. Open scam
  // checks do not block it, since they stay open until I verify a listing by hand, but the card
  // shows "scam checks pending". A failed one already made the bucket "fail".
  const budget = results.find((r) => r.filter === "budget");
  if (
    bucket === "needs_info" &&
    budget?.status === "unknown" &&
    isLikelyOnCost(cost, settings, facts) &&
    results.every((r) => r.filter === "budget" || r.filter === "scam_checks" || r.status === "pass")
  ) {
    bucket = "likely";
  }
  const seen = new Set<string>();
  const questions = results
    .flatMap((r) => r.questions)
    .filter((q) => (seen.has(q.field) ? false : (seen.add(q.field), true)));
  if (bucket !== "likely") return { bucket, results, questions };
  const scamOpen = results.some((r) => r.filter === "scam_checks" && r.status === "unknown");
  return scamOpen
    ? { bucket, results, questions, likelyReason: LIKELY_REASON, scamNote: SCAM_CHECKS_PENDING }
    : { bucket, results, questions, likelyReason: LIKELY_REASON };
}
