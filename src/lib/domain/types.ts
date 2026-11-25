// Inputs to the domain functions. Every listing field is nullable: null means Unknown, and it is
// never treated as 0. A known value carries its provenance, which decides Confirmed vs Estimated.
// Money is integer cents, durations are integer minutes, dates are ISO strings (YYYY-MM-DD).

import type { SoftFactor } from "@/db/defaults";
import type { Provenance } from "@/db/schema";
import type { Settings } from "@/db/settings-schema";
import type { TransitRoute } from "@/lib/regions/types";

export type { Provenance, Settings, SoftFactor, TransitRoute };

export type Fact<T> = { value: T; provenance: Provenance; sourceUrl?: string | null; note?: string | null };

export type ListingType = "room" | "studio" | "apartment";
export type LeaseType = "fixed" | "month_to_month" | "sublet";
/** How a fixed lease longer than the stay can be ended early. */
export type ExitClause = "break" | "sublet" | "none";

export const SCAM_CHECK_IDS = [
  "price_far_below_market",
  "no_live_video_tour",
  "untraceable_payment_before_lease",
  "overseas_landlord",
  "photos_reused",
  "pressure_to_pay_fast",
  "not_owner_or_address_mismatch",
] as const;
export type ScamCheckId = (typeof SCAM_CHECK_IDS)[number];
/** Per check: pass, fail, resolved (a failed check I have since cleared), or null (not checked). */
export type ScamCheckStatus = "pass" | "fail" | "resolved";
export type ScamChecks = { [K in ScamCheckId]: ScamCheckStatus | null };

export type NearbyStop = {
  name?: string;
  walkMinutes: number;
  /** Weekday rush-hour headway. Null when the frequency job has no data for it. */
  rushHeadwayMinutes: number | null;
  /** A regional rail station, such as Caltrain. */
  regionalRail: boolean;
};

export type Reviews = {
  /** Average rating out of 5. */
  averageRating: number;
  /** Reviews from the last 2 years. 0 means there are none. */
  recentCount: number;
};

export interface ListingFactValues {
  type: ListingType;
  city: string;

  // Recurring costs, per month.
  rentCents: number;
  shortTermPremiumCents: number;
  /** Amenity, admin, valet trash, bundled parking. */
  mandatoryFeesMonthlyCents: number;
  utilitiesIncluded: boolean;
  /** My share of utilities as stated by the listing or landlord. */
  utilitiesMyShareCents: number;
  /** People living in the unit, including me. */
  householdSize: number;
  internetIncluded: boolean;
  internetMonthlyCents: number;
  rentersInsuranceRequired: boolean;
  rentersInsuranceMonthlyCents: number;

  // One-time costs.
  /** Application, admin, holding and broker fees, total. */
  oneTimeFeesCents: number;
  nonRefundableDepositCents: number;
  refundableDepositCents: number;
  /** Whether the place lacks bedding, towels or kitchen basics. */
  lacksBasics: boolean;
  /** Cost to buy the basics it lacks. */
  setupItemsCents: number;

  // Lease.
  availableFrom: string;
  leaseType: LeaseType;
  /** Term in months, for a fixed lease. */
  leaseMonths: number;
  /** End date, for a sublet. */
  leaseEnd: string;
  exitClause: ExitClause;
  breakFeeCents: number;

  // Room.
  privateBedroom: boolean;
  privateBath: boolean;
  furnished: boolean;
  hasBed: boolean;
  hasDesk: boolean;
  hasChair: boolean;
  kitchenEquipped: boolean;

  // Location.
  /** Door to office by transit and walking, weekday 8 to 9 am. */
  commuteMinutes: number;
  commuteRoute: TransitRoute;
  nearbyStops: NearbyStop[];
  groceryWalkMinutes: number;
  gymWalkMinutes: number;
  /** Walk minutes to each cafe found nearby. Empty means none. */
  cafeWalkMinutes: number[];

  // Trust and people.
  reviews: Reviews;
  scamChecks: ScamChecks;
  hasRoommates: boolean;
  canMeetRoommates: boolean;
}

export type ListingFacts = { [K in keyof ListingFactValues]: Fact<ListingFactValues[K]> | null };

/** A listing where every field is Unknown. Spread known facts over it. */
export function unknownListing(): ListingFacts {
  return {
    type: null,
    city: null,
    rentCents: null,
    shortTermPremiumCents: null,
    mandatoryFeesMonthlyCents: null,
    utilitiesIncluded: null,
    utilitiesMyShareCents: null,
    householdSize: null,
    internetIncluded: null,
    internetMonthlyCents: null,
    rentersInsuranceRequired: null,
    rentersInsuranceMonthlyCents: null,
    oneTimeFeesCents: null,
    nonRefundableDepositCents: null,
    refundableDepositCents: null,
    lacksBasics: null,
    setupItemsCents: null,
    availableFrom: null,
    leaseType: null,
    leaseMonths: null,
    leaseEnd: null,
    exitClause: null,
    breakFeeCents: null,
    privateBedroom: null,
    privateBath: null,
    furnished: null,
    hasBed: null,
    hasDesk: null,
    hasChair: null,
    kitchenEquipped: null,
    commuteMinutes: null,
    commuteRoute: null,
    nearbyStops: null,
    groceryWalkMinutes: null,
    gymWalkMinutes: null,
    cafeWalkMinutes: null,
    reviews: null,
    scamChecks: null,
    hasRoommates: null,
    canMeetRoommates: null,
  };
}

/** A question for the landlord, or a task for me when the landlord is not the one to ask. */
export type Question = { field: string; ask: "landlord" | "me"; text: string };

export function isEstimate(fact: Fact<unknown>): boolean {
  return fact.provenance === "estimate";
}
