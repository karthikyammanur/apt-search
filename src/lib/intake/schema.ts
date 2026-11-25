// The listing schema the model fills, mirroring the `facts` fields in docs/design.md.
//
// The model reads. It does not compute. Money comes back as plain dollars exactly as written in
// the post, and code converts it to integer cents. Every field is optional: a field the text does
// not state stays null, and the form says so. Field names here are snake_case for the model;
// they map one to one onto the camelCase facts the domain layer reads (ListingFactValues).

import { z } from "zod";
import { POST_TYPES } from "@/db/schema";
import type { ListingFactValues } from "@/lib/domain";
import type { Draft } from "./types";

const usd = z.number().finite().nonnegative().nullish();
const bool = z.boolean().nullish();
const text = z.string().nullish();

export const extractionSchema = z.object({
  post_type: z.enum(POST_TYPES),
  type: z.enum(["room", "studio", "apartment"]).nullish(),
  address: text,
  city: text,

  rent_usd: usd,
  short_term_premium_usd: usd,
  mandatory_fees_monthly_usd: usd,
  utilities_included: bool,
  utilities_my_share_usd: usd,
  household_size: z.number().int().positive().nullish(),
  internet_included: bool,
  internet_monthly_usd: usd,
  renters_insurance_required: bool,
  renters_insurance_monthly_usd: usd,
  one_time_fees_usd: usd,
  non_refundable_deposit_usd: usd,
  refundable_deposit_usd: usd,
  basics_provided: bool,

  available_from: text,
  lease_type: z.enum(["fixed", "month_to_month", "sublet"]).nullish(),
  lease_months: z.number().int().positive().nullish(),
  lease_end: text,
  exit_clause: z.enum(["break", "sublet", "none"]).nullish(),
  break_fee_usd: usd,

  private_bedroom: bool,
  private_bath: bool,
  furnished: bool,
  has_bed: bool,
  has_desk: bool,
  has_chair: bool,
  kitchen_equipped: bool,
  has_roommates: bool,
  can_meet_roommates: bool,

  /** roommate_wanted posts only. */
  dates_wanted: text,
  budget_usd: usd,
});

export type Extraction = z.infer<typeof extractionSchema>;

const MONEY_FIELDS = [
  ["rent_usd", "rentCents"],
  ["short_term_premium_usd", "shortTermPremiumCents"],
  ["mandatory_fees_monthly_usd", "mandatoryFeesMonthlyCents"],
  ["utilities_my_share_usd", "utilitiesMyShareCents"],
  ["internet_monthly_usd", "internetMonthlyCents"],
  ["renters_insurance_monthly_usd", "rentersInsuranceMonthlyCents"],
  ["one_time_fees_usd", "oneTimeFeesCents"],
  ["non_refundable_deposit_usd", "nonRefundableDepositCents"],
  ["refundable_deposit_usd", "refundableDepositCents"],
  ["break_fee_usd", "breakFeeCents"],
] as const satisfies readonly (readonly [keyof Extraction, keyof ListingFactValues])[];

const PLAIN_FIELDS = [
  ["type", "type"],
  ["city", "city"],
  ["utilities_included", "utilitiesIncluded"],
  ["household_size", "householdSize"],
  ["internet_included", "internetIncluded"],
  ["renters_insurance_required", "rentersInsuranceRequired"],
  ["available_from", "availableFrom"],
  ["lease_type", "leaseType"],
  ["lease_months", "leaseMonths"],
  ["lease_end", "leaseEnd"],
  ["exit_clause", "exitClause"],
  ["private_bedroom", "privateBedroom"],
  ["private_bath", "privateBath"],
  ["furnished", "furnished"],
  ["has_bed", "hasBed"],
  ["has_desk", "hasDesk"],
  ["has_chair", "hasChair"],
  ["kitchen_equipped", "kitchenEquipped"],
  ["has_roommates", "hasRoommates"],
  ["can_meet_roommates", "canMeetRoommates"],
] as const satisfies readonly (readonly [keyof Extraction, keyof ListingFactValues])[];

/** Every number in a text, as plain numbers. "$2,400", "2400" and "2.4k" all give 2400. */
export function numbersIn(source: string): Set<number> {
  const found = new Set<number>();
  for (const match of source.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/gi)) {
    const value = Number.parseFloat((match[1] ?? "").replace(/,/g, ""));
    if (Number.isFinite(value)) found.add(match[2] ? value * 1000 : value);
  }
  return found;
}

/** A stated zero needs some wording that says so, since a zero never appears as a digit. */
const ZERO_WORDING = /\bno\s+(?:\w+\s+){0,2}(?:fees?|charges?|deposit)|\b(?:free|waived|included|none)\b|\$\s?0\b/i;

/**
 * A dollar amount counts only if it appears in the post text (or the channel's structured data).
 * This stops a model from inventing a figure, or obeying an instruction hidden in the text that
 * tells it to report one.
 */
export function isGrounded(amount: number, source: string): boolean {
  if (amount === 0) return ZERO_WORDING.test(source);
  return numbersIn(source).has(amount);
}

export function usdToCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Words that must appear in the post for a yes/no claim on a dealbreaker field to stand. A small
 * model sometimes infers "private bedroom" from the word "room". A true or false with no words
 * behind it is dropped to Unknown, so a guess can neither pass nor silently fail a listing.
 *
 * `wholePlace` words (studio, apartment, 1b1b...) describe the unit, not the room. They count as
 * evidence only when the post offers the whole place: "Room in 2B1B Apartment" says nothing about
 * whether the bedroom or the bathroom is mine.
 */
type Evidence = { yes: RegExp; no: RegExp; wholePlace?: RegExp };

const WHOLE_PLACE_WORDS = /studio|entire|whole|apartment|\bapt\b|\b\d\s*(?:br|bd|bed)\b|\b1b1b\b/i;

const EVIDENCE: Partial<Record<keyof ListingFactValues, Evidence>> = {
  privateBedroom: {
    yes: /private(?:(?!bath)[^.\n]){0,25}\b(?:bed)?room\b|\bown\s+(?:private\s+)?(?:bed)?room\b|en-?suite|\b(?:1|one)\s+(?:private\s+)?bedroom\s+(?:is\s+)?(?:available|for\s+rent|open)\b|\bbedroom\s+(?:is\s+)?available\b/i,
    no: /shar(?:ed|e|ing)\s+(?:a\s+|the\s+)?(?:bed)?room|double\s+room|bunk|twin\s+beds/i,
    wholePlace: WHOLE_PLACE_WORDS,
  },
  privateBath: {
    yes: /private\s+(?:bath|bathroom)|own\s+(?:private\s+)?(?:bath|bathroom)|en-?suite|attached\s+bath/i,
    no: /shar(?:ed|e|ing)\s+(?:a\s+|the\s+)?(?:bath|bathroom)|common\s+(?:bath|bathroom)/i,
    wholePlace: /studio|entire|whole|apartment|\bapt\b|\b\d\s*(?:ba|bath)\b|\b1b1b\b/i,
  },
  furnished: {
    yes: /furnish|\bbed\b|desk|couch|sofa/i,
    no: /unfurnished|not\s+furnished|no\s+furniture|bring\s+your\s+own|partially\s+furnished/i,
  },
  utilitiesIncluded: {
    yes: /utilit|all[- ]in|bills?\s+(?:are\s+)?included|\bwater\b|electric|wi-?fi|internet/i,
    no: /utilities\s+(?:are\s+)?(?:not\s+included|extra|separate|additional)|(?:plus|\+)\s*utilities|excl(?:uding|uded)?\s+utilities/i,
  },
  internetIncluded: {
    yes: /internet|wi-?fi|utilit|all[- ]in/i,
    no: /no\s+(?:internet|wi-?fi)|internet\s+(?:is\s+)?(?:not\s+included|extra)/i,
  },
};

// Dates written in the post. The model leaves a date without a year as null (its prompt says so),
// so code reads ranges such as "Dec 12 to Jan 9", "12/15-12/22", "Dec 15-22" and "Jan 1 - Aug 31",
// and open ends such as "until December", and supplies the year: the coming occurrence of that
// month, counted from the post date ("Posted: YYYY-MM-DD" in the text) or else today.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const YEAR = String.raw`(?:,?\s*(20\d{2}))?`;
/** One date: "12th December", "Dec 6th", "12/15" or "12/15/26", or a bare month ("December"). */
const DATE_TOKEN = new RegExp(
  [
    String.raw`\b${DAY}\s+(?:of\s+)?${MONTH}${YEAR}\b`,
    String.raw`\b${MONTH}\s+${DAY}\b${YEAR}`,
    String.raw`\b(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?\b`,
    String.raw`\b${MONTH}${YEAR}\b`,
  ].join("|"),
  "gi",
);
const RANGE_JOIN = /^\s*(?:-|to|until|till|thru|through)\s*$/i;
const OPEN_END = /\b(?:until|till|thru|through)\s*$/i;
/** Words that say a date is when the place becomes available: "starting from Feb", "available Jan 5". */
const START_WORD = /\b(?:start(?:s|ing)?|available|avail?aible|beginning|begins|move[- ]?in(?:\s+date)?|from)(?:\s+(?:from|on|in))?\s*:?\s*$/i;
/** "Dec 15-22": a day after a dash, ending a range in the start's month. */
const DAY_ONLY_END = /^\s*-\s*(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*[/:])/;

type DateToken = { start: number; end: number; month: number; day: number | null; year: number | null };

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function fullYear(value: string | undefined): number | null {
  if (!value) return null;
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

function dateTokens(text: string): DateToken[] {
  const tokens: DateToken[] = [];
  for (const m of text.matchAll(DATE_TOKEN)) {
    const at = { start: m.index, end: m.index + m[0].length };
    if (m[2]) tokens.push({ ...at, month: monthIndex(m[2]), day: Number(m[1]), year: fullYear(m[3]) });
    else if (m[4]) tokens.push({ ...at, month: monthIndex(m[4]), day: Number(m[5]), year: fullYear(m[6]) });
    else if (m[7]) tokens.push({ ...at, month: Number(m[7]), day: Number(m[8]), year: fullYear(m[9]) });
    else if (m[10]) tokens.push({ ...at, month: monthIndex(m[10]), day: null, year: fullYear(m[11]) });
  }
  return tokens.filter((t) => t.month >= 1 && t.month <= 12);
}

function isoOf(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The year of the next time this month comes round, counted from the reference date. */
function comingYear(month: number, reference: string): number {
  const [year, refMonth] = reference.split("-").map(Number) as [number, number];
  return month >= refMonth ? year : year + 1;
}

export type StatedDates = {
  availableFrom: string | null;
  leaseEnd: string | null;
  /** "until December" with no start: an end date only. */
  openEnded: boolean;
};

/** The first date range or open end stated in the text. Dates are ISO; null when none is stated. */
export function statedDates(text: string, reference: string): StatedDates {
  const clean = text.replace(/[‒-―]/g, "-");
  const tokens = dateTokens(clean);
  for (const [i, from] of tokens.entries()) {
    const next = tokens[i + 1];
    const startYear = from.year ?? comingYear(from.month, reference);
    const startIso = isoOf(startYear, from.month, from.day ?? 1);
    if (next && RANGE_JOIN.test(clean.slice(from.end, next.start)) && startIso) {
      // "Dec 12 to Jan 9" runs into the next year. "Jan 9 to Jan 2" is a typo, not a year: the
      // end date check below rejects it.
      const endYear = next.year ?? (next.month < from.month ? startYear + 1 : startYear);
      const endIso = isoOf(endYear, next.month, next.day ?? lastDayOf(endYear, next.month));
      if (endIso && endIso > startIso) return { availableFrom: startIso, leaseEnd: endIso, openEnded: false };
    }
    const dayOnly = from.day !== null ? DAY_ONLY_END.exec(clean.slice(from.end)) : null;
    if (dayOnly && startIso && from.day !== null) {
      const endDay = Number(dayOnly[1]);
      const rollover = endDay < from.day;
      const endMonth = rollover ? (from.month % 12) + 1 : from.month;
      const endYear = rollover && from.month === 12 ? startYear + 1 : startYear;
      const endIso = isoOf(endYear, endMonth, endDay);
      if (endIso && endIso > startIso) return { availableFrom: startIso, leaseEnd: endIso, openEnded: false };
    }
    // "starting from Feb or March": a start with no end. Several months are read as the earliest,
    // so the date can only be too early, never later than the post allows.
    if (startIso && START_WORD.test(clean.slice(0, from.start))) return { availableFrom: startIso, leaseEnd: null, openEnded: false };
    if (OPEN_END.test(clean.slice(0, from.start))) {
      const endIso = isoOf(startYear, from.month, from.day ?? lastDayOf(startYear, from.month));
      if (endIso) return { availableFrom: null, leaseEnd: endIso, openEnded: true };
    }
  }
  return { availableFrom: null, leaseEnd: null, openEnded: false };
}

/** The post date the channel wrote into the text ("Posted: 2026-11-22T..."), if any. */
export function postedDate(text: string): string | null {
  return /\bPosted:\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? null;
}

const SUBLET_WORDS = /\bsub-?le(?:t|ase|asing|tting)\b|\bsublet/i;
/** "lease" on its own (not "sublease"), as in "6-month lease". */
const LEASE_WORD = /(?<![a-z-])lease\b/i;

/**
 * Fill the dates and lease type from what the text states, where the model left them empty.
 * An open end ("until December") is a sublet unless the post talks about a lease: a fixed lease
 * is stated with a length or two dates, not just an end.
 */
function applyStatedDates(facts: Partial<ListingFactValues>, text: string, reference: string, issues: string[]): void {
  const dates = statedDates(text, reference);
  if (dates.availableFrom && facts.availableFrom === undefined) {
    facts.availableFrom = dates.availableFrom;
    issues.push(`availableFrom ${dates.availableFrom} read from the dates in the post`);
  }
  if (dates.leaseEnd && facts.leaseEnd === undefined) {
    facts.leaseEnd = dates.leaseEnd;
    issues.push(`leaseEnd ${dates.leaseEnd} read from the dates in the post`);
  }
  if (dates.openEnded && !LEASE_WORD.test(text) && facts.leaseType !== "month_to_month" && facts.leaseType !== "sublet") {
    if (facts.leaseType === "fixed") issues.push("leaseType fixed changed to sublet: the post gives only an end date");
    facts.leaseType = "sublet";
  } else if (!dates.openEnded && dates.leaseEnd && facts.leaseType === undefined) {
    facts.leaseType = SUBLET_WORDS.test(text) ? "sublet" : "fixed";
  }
}

export type DraftOptions = {
  /** False for screenshots: they carry facts the text does not, so the text checks cannot apply. */
  verify?: boolean;
  /** ISO date that a date without a year is counted from, when the text has no post date. */
  today?: string;
};

/**
 * Turn the model's form into a draft. Only values the model stated, and the text supports, are
 * kept. `groundingText` is everything a number may legitimately come from.
 */
export function toDraft(extraction: Extraction, groundingText: string, options: DraftOptions = {}): Draft {
  const verify = options.verify ?? true;
  const issues: string[] = [];
  const facts: Partial<ListingFactValues> = {};
  const target = facts as Record<string, unknown>;

  for (const [from, to] of PLAIN_FIELDS) {
    const value = extraction[from];
    if (value !== null && value !== undefined && value !== "") target[to] = value;
  }
  if (verify) {
    const wholePlace = extraction.post_type === "whole_place_offered" || (facts.type !== undefined && facts.type !== "room");
    for (const [field, patterns] of Object.entries(EVIDENCE) as [keyof ListingFactValues, Evidence][]) {
      const claim = facts[field];
      if (typeof claim !== "boolean") continue;
      const supported = claim
        ? patterns.yes.test(groundingText) || (wholePlace && patterns.wholePlace?.test(groundingText) === true)
        : patterns.no.test(groundingText);
      if (!supported) {
        delete target[field];
        issues.push(`${field} ${claim} has no support in the post text, dropped`);
      }
    }
  }
  if (extraction.post_type === "room_offered" || extraction.post_type === "whole_place_offered") {
    const reference = postedDate(groundingText) ?? options.today ?? new Date().toISOString().slice(0, 10);
    applyStatedDates(facts, groundingText, reference, issues);
  }
  for (const [from, to] of MONEY_FIELDS) {
    const amount = extraction[from];
    if (amount === null || amount === undefined) continue;
    if (verify && !isGrounded(amount, groundingText)) {
      issues.push(`${from} ${amount} is not in the post text, dropped`);
      continue;
    }
    target[to] = usdToCents(amount);
  }
  if (extraction.basics_provided !== null && extraction.basics_provided !== undefined) {
    // "Provides bedding and kitchenware" means the place does not lack the basics.
    facts.lacksBasics = !extraction.basics_provided;
  }

  const budget = extraction.budget_usd;
  const budgetCents =
    budget !== null && budget !== undefined && (!verify || isGrounded(budget, groundingText))
      ? usdToCents(budget)
      : null;

  return {
    postType: extraction.post_type,
    address: extraction.address?.trim() || null,
    lat: null,
    lng: null,
    facts,
    roommate:
      extraction.post_type === "roommate_wanted"
        ? { datesWanted: extraction.dates_wanted?.trim() || null, budgetCents }
        : null,
    issues,
  };
}
