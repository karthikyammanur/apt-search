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
 */
const EVIDENCE: Partial<Record<keyof ListingFactValues, { yes: RegExp; no: RegExp }>> = {
  privateBedroom: {
    yes: /private[^.\n]{0,25}\b(?:bed)?room\b|own\s+(?:bed)?room|en-?suite|studio|entire|whole|apartment|\bapt\b|\b\d\s*(?:br|bd|bed)\b|\b1b1b\b/i,
    no: /shar(?:ed|e|ing)\s+(?:a\s+|the\s+)?(?:bed)?room|double\s+room|bunk|twin\s+beds/i,
  },
  privateBath: {
    yes: /private\s+(?:bath|bathroom)|own\s+(?:bath|bathroom)|en-?suite|attached\s+bath|studio|entire|whole|apartment|\bapt\b|\b\d\s*(?:ba|bath)\b|\b1b1b\b/i,
    no: /shar(?:ed|e|ing)\s+(?:a\s+|the\s+)?(?:bath|bathroom)|common\s+(?:bath|bathroom)/i,
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

/**
 * Turn the model's form into a draft. Only values the model stated, and the text supports, are
 * kept. `groundingText` is everything a number may legitimately come from.
 */
export function toDraft(extraction: Extraction, groundingText: string, options: { verify?: boolean } = {}): Draft {
  // Screenshots carry facts the text does not, so the text checks cannot be applied to them.
  const verify = options.verify ?? true;
  const issues: string[] = [];
  const facts: Partial<ListingFactValues> = {};
  const target = facts as Record<string, unknown>;

  for (const [from, to] of PLAIN_FIELDS) {
    const value = extraction[from];
    if (value !== null && value !== undefined && value !== "") target[to] = value;
  }
  if (verify) {
    for (const [field, patterns] of Object.entries(EVIDENCE) as [keyof ListingFactValues, { yes: RegExp; no: RegExp }][]) {
      const claim = facts[field];
      if (typeof claim !== "boolean") continue;
      if (!(claim ? patterns.yes : patterns.no).test(groundingText)) {
        delete target[field];
        issues.push(`${field} ${claim} has no support in the post text, dropped`);
      }
    }
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
