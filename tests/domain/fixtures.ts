// Neutral fixtures for the domain tests. The office address is a placeholder, not a real one.

import { SOFT_FACTORS } from "@/db/defaults";
import {
  SCAM_CHECK_IDS,
  unknownListing,
  type Fact,
  type ListingFacts,
  type Provenance,
  type ScamChecks,
  type Settings,
  type Weights,
} from "@/lib/domain";

export const settings: Settings = {
  officeAddress: "1 Example St, Palo Alto, CA",
  region: "bay-area",
  moveInEarliest: "2027-01-02",
  moveInLatest: "2027-01-08",
  startDate: "2027-01-11",
  moveOut: "2027-08-13",
  budgetCapCents: 250000,
  maxCommuteMinutes: 30,
  requirePrivateBedroom: true,
  requirePrivateBath: true,
  requireFurnished: true,
};

export function f<T>(value: T, provenance: Provenance = "listing"): Fact<T> {
  return { value, provenance };
}

export const allScamChecksPass = Object.fromEntries(SCAM_CHECK_IDS.map((id) => [id, "pass"])) as ScamChecks;

/**
 * A room where every fact is known and confirmed, with no extra costs: utilities and internet
 * included, no fees, a 7-month lease from Jan 2. All-in equals rent.
 */
export function cleanListing(overrides: Partial<ListingFacts> = {}): ListingFacts {
  return {
    ...unknownListing(),
    type: f("room"),
    city: f("Palo Alto"),
    rentCents: f(200000),
    shortTermPremiumCents: f(0),
    mandatoryFeesMonthlyCents: f(0),
    utilitiesIncluded: f(true),
    householdSize: f(4),
    internetIncluded: f(true),
    rentersInsuranceRequired: f(false),
    oneTimeFeesCents: f(0),
    nonRefundableDepositCents: f(0),
    refundableDepositCents: f(200000),
    lacksBasics: f(false),
    availableFrom: f("2027-01-02"),
    leaseType: f("fixed"),
    leaseMonths: f(7),
    privateBedroom: f(true),
    privateBath: f(true),
    furnished: f(true),
    hasBed: f(true),
    hasDesk: f(true),
    hasChair: f(true),
    kitchenEquipped: f(true),
    commuteMinutes: f(20, "api"),
    commuteRoute: f(
      {
        legs: [
          { mode: "walk" as const },
          { mode: "transit" as const, agency: "caltrain", from: "Mountain View", to: "Palo Alto" },
          { mode: "walk" as const },
        ],
      },
      "api",
    ),
    nearbyStops: f([{ name: "Mountain View", walkMinutes: 4, rushHeadwayMinutes: 20, regionalRail: true }], "api"),
    groceryWalkMinutes: f(8, "api"),
    gymWalkMinutes: f(12, "api"),
    cafeWalkMinutes: f([3, 6, 9], "api"),
    reviews: f({ averageRating: 4.6, recentCount: 6 }),
    scamChecks: f(allScamChecksPass, "me"),
    hasRoommates: f(true),
    canMeetRoommates: f(true),
    ...overrides,
  };
}

export const equalWeights = Object.fromEntries(SOFT_FACTORS.map((k) => [k, 1 / SOFT_FACTORS.length])) as Weights;
