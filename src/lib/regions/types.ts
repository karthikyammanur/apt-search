// What a region pack provides: local defaults the cost model cannot get from a listing.
// Every number carries a source URL and the date it was checked.

import type { Rat } from "@/lib/domain/rational";

export type Source = {
  url: string;
  /** ISO date the value was checked against the source. */
  asOf: string;
  note: string;
};

/** A monthly amount from the pack. Pack values are always estimates. */
export type RegionAmount =
  | { status: "estimate"; monthlyCents: Rat; source: Source; note: string }
  | { status: "unknown"; reason: string };

export type TransitLeg = {
  mode: "walk" | "bike" | "transit";
  /** Agency id for transit legs, such as "caltrain", "vta", "samtrans" or "marguerite". */
  agency?: string | null;
  /** Boarding stop or station name. Caltrain legs need it to find the fare zone. */
  from?: string | null;
  /** Alighting stop or station name. */
  to?: string | null;
};

export type TransitRoute = { legs: TransitLeg[] };

export type PassLine = { agency: string; product: string; cents: number; source: Source };

export type PassChoice =
  | { status: "estimate"; monthlyCents: number; passes: PassLine[]; reason: string }
  | { status: "unknown"; reason: string };

export type UtilitiesInput = {
  city: string | null;
  /** People living in the unit, including me. Null when unknown. */
  householdSize: number | null;
};

export interface RegionPack {
  id: string;
  name: string;
  /** False for a region without a pack: every value it returns is Unknown. */
  hasData: boolean;
  utilitiesMonthly(input: UtilitiesInput): RegionAmount;
  internetMonthly(): RegionAmount;
  rentersInsuranceMonthly(): RegionAmount;
  /** The cheapest set of monthly passes that covers every transit leg of the route. */
  cheapestPass(route: TransitRoute): PassChoice;
}
