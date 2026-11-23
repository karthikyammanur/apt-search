// Stage 1b: validate. Plain code, no model. Sanity rules from docs/design.md: rent $300 to
// $10,000, dates inside 2026 to 2027, and the city inside the search area. A value that breaks a
// range becomes Unknown (the key is removed) and is noted in `issues`. A listing whose address
// is outside California is rejected. A city outside the Bay Area list is only noted: the search
// area is wherever the commute passes (docs/requirements.md), and a neighborhood name such as
// "Willow Glen" is not a reason to drop a listing. The commute filter decides.

import type { ListingFactValues, Settings } from "@/lib/domain";
import type { Draft } from "./types";

export const RENT_RANGE_CENTS = { min: 30_000, max: 1_000_000 } as const;
const MONEY_MAX_CENTS = 1_000_000;

const MONEY_KEYS = [
  "rentCents",
  "shortTermPremiumCents",
  "mandatoryFeesMonthlyCents",
  "utilitiesMyShareCents",
  "internetMonthlyCents",
  "rentersInsuranceMonthlyCents",
  "oneTimeFeesCents",
  "nonRefundableDepositCents",
  "refundableDepositCents",
  "setupItemsCents",
  "breakFeeCents",
] as const satisfies readonly (keyof ListingFactValues)[];

/** Cities the Bay Area pack knows. A city outside this list is noted, not rejected. */
export const BAY_AREA_CITIES: ReadonlySet<string> = new Set(
  [
    "palo alto", "east palo alto", "menlo park", "atherton", "redwood city", "san carlos",
    "belmont", "san mateo", "foster city", "burlingame", "millbrae", "san bruno",
    "south san francisco", "daly city", "san francisco", "mountain view", "los altos",
    "los altos hills", "sunnyvale", "cupertino", "santa clara", "san jose", "milpitas",
    "campbell", "los gatos", "saratoga", "portola valley", "woodside", "stanford",
    "half moon bay", "oakland", "berkeley", "emeryville", "alameda", "fremont", "newark",
    "union city", "hayward", "san leandro",
  ],
);

const STATE_ZIP = /,\s*([A-Z]{2})\s+\d{5}\b/;
const STATE_ONLY = /,\s*([A-Z]{2})\s*$/;

/** The two-letter state in an address, when it has one. */
export function stateOf(address: string | null): string | null {
  if (!address) return null;
  return (STATE_ZIP.exec(address) ?? STATE_ONLY.exec(address))?.[1] ?? null;
}

export type ValidateResult =
  | { ok: true; draft: Draft }
  | { ok: false; reason: "outside_california"; draft: Draft };

function inYears(value: unknown): value is string {
  return typeof value === "string" && /^202[67]-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateDraft(draft: Draft, settings: Pick<Settings, "region">): ValidateResult {
  const issues = [...draft.issues];
  const facts: Partial<ListingFactValues> = { ...draft.facts };
  const bag = facts as Record<string, unknown>;
  const drop = (key: keyof ListingFactValues, why: string) => {
    delete bag[key];
    issues.push(`${key} ${why}, treated as Unknown`);
  };

  for (const key of MONEY_KEYS) {
    const value = facts[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value > MONEY_MAX_CENTS) drop(key, "is out of range");
  }
  const rent = facts.rentCents;
  if (rent !== undefined && (rent < RENT_RANGE_CENTS.min || rent > RENT_RANGE_CENTS.max)) {
    drop("rentCents", "is outside $300 to $10,000");
  }
  for (const key of ["availableFrom", "leaseEnd"] as const) {
    if (facts[key] !== undefined && !inYears(facts[key])) drop(key, "is not a date in 2026 or 2027");
  }
  if (facts.leaseMonths !== undefined && !(facts.leaseMonths >= 1 && facts.leaseMonths <= 36)) {
    drop("leaseMonths", "is out of range");
  }
  if (facts.householdSize !== undefined && !(facts.householdSize >= 1 && facts.householdSize <= 20)) {
    drop("householdSize", "is out of range");
  }

  const cleaned: Draft = { ...draft, facts, issues };
  const state = stateOf(draft.address);
  if (state !== null && state !== "CA") return { ok: false, reason: "outside_california", draft: cleaned };
  const city = (facts.city ?? "").trim().toLowerCase().replace(/,?\s*(?:ca|california)$/, "");
  if (settings.region === "bay-area" && city && !BAY_AREA_CITIES.has(city)) {
    issues.push(`city "${facts.city}" is not in the Bay Area list, the commute will decide`);
  }
  return { ok: true, draft: cleaned };
}
