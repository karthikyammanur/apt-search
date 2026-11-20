// Bay Area region pack. Every number has a source URL and the date it was checked. All values
// are estimates: prices change, and a listing or landlord answer always wins over them.

import { ratFrac, ratInt } from "@/lib/domain/rational";
import type {
  PassChoice,
  PassLine,
  RegionAmount,
  RegionPack,
  Source,
  TransitRoute,
  UtilitiesInput,
} from "./types";

const CHECKED = "2026-11-20";

export const SOURCES = {
  caltrainFares: {
    url: "https://www.caltrain.com/fares",
    asOf: CHECKED,
    note:
      "Adult monthly pass, priced at 24 one-way fares. A proposed +$0.25 zone upgrade on " +
      "2027-01-01 would make 2 zones $156; not confirmed as adopted (https://www.caltrain.com/node/11802).",
  },
  vtaFares: {
    url: "https://www.vta.gov/fares",
    asOf: CHECKED,
    note: "Adult monthly pass, bus and light rail. Not re-verified: the page failed to load on the check date.",
  },
  samtransFares: {
    url: "https://www.samtrans.com/fares/",
    asOf: CHECKED,
    note: "Adult (19 to 64) monthly pass on Clipper.",
  },
  marguerite: {
    url: "https://transportation.stanford.edu/getting-stanford/public-transit",
    asOf: CHECKED,
    note: "Stanford Marguerite shuttle is free and open to the public.",
  },
  utilityBills: {
    url: "https://www.paloalto.gov/files/assets/public/v/1/utilities/bill-inserts/pal195-billinsert-rates-6.2026.pdf",
    asOf: CHECKED,
    note:
      "City of Palo Alto Utilities bill insert (June 2026), FY2026 median residential bill per city at " +
      "Palo Alto median usage, electric, gas, water, wastewater, stormwater and refuse, before taxes and fees.",
  },
  householdSize: {
    url: "https://www.census.gov/quickfacts/fact/table/paloaltocitycalifornia",
    asOf: CHECKED,
    note: "Census QuickFacts, Palo Alto city, persons per household 2019 to 2023: 2.55.",
  },
  internet: {
    url: "https://www.cabletv.com/internet-near-me/ca/palo-alto",
    asOf: CHECKED,
    note: "Lowest listed starting price for home internet in Palo Alto (Xfinity, from $45.00 a month).",
  },
  rentersInsurance: {
    url: "https://www.nerdwallet.com/article/insurance/renters-insurance-california",
    asOf: CHECKED,
    note: "Average renters insurance in California, about $15 a month ($175 a year).",
  },
} as const satisfies Record<string, Source>;

/** Adult Caltrain monthly pass, by number of zones covered. */
export const CALTRAIN_MONTHLY_PASS_CENTS: Readonly<Record<number, number>> = { 1: 9600, 2: 15000 };
export const VTA_MONTHLY_PASS_CENTS = 9000;
export const SAMTRANS_MONTHLY_PASS_CENTS = 6560;
export const MARGUERITE_MONTHLY_CENTS = 0;
export const INTERNET_MONTHLY_CENTS = 4500;
export const RENTERS_INSURANCE_MONTHLY_CENTS = 1500;

/** Caltrain fare zone of each station near the office. Keys are normalized station names. */
export const CALTRAIN_ZONES: Readonly<Record<string, number>> = {
  "redwood city": 2,
  "menlo park": 3,
  "palo alto": 3,
  "california ave": 3,
  "san antonio": 3,
  "mountain view": 3,
  sunnyvale: 3,
};

/** FY2026 median monthly residential utility bill for a whole household, in cents. */
export const HOUSEHOLD_UTILITY_BILL_CENTS: Readonly<Record<string, number>> = {
  "palo alto": 42600,
  "menlo park": 53000,
  "redwood city": 54100,
  "mountain view": 45700,
};

/** Used for a city the bill table does not list: the highest bill in it, to stay on the safe side. */
const FALLBACK_HOUSEHOLD_BILL_CENTS = Math.max(...Object.values(HOUSEHOLD_UTILITY_BILL_CENTS));

/** 2.55 persons per household, as the exact fraction 255 / 100. */
const PERSONS_PER_HOUSEHOLD = { hundredths: 255 } as const;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bcaltrain\b|\bstation\b/g, " ")
    .replace(/\bavenue\b/g, "ave")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function caltrainZone(station: string | null | undefined): number | null {
  if (!station) return null;
  return CALTRAIN_ZONES[normalizeName(station)] ?? null;
}

function utilitiesMonthly({ city, householdSize }: UtilitiesInput): RegionAmount {
  const cityKey = city ? normalizeName(city) : "";
  const listed = HOUSEHOLD_UTILITY_BILL_CENTS[cityKey];
  const bill = listed ?? FALLBACK_HOUSEHOLD_BILL_CENTS;
  const cityNote = listed
    ? `${city} median household bill`
    : `highest median household bill in the table (city ${city ?? "Unknown"} is not listed)`;
  const shared =
    householdSize !== null && Number.isInteger(householdSize) && householdSize >= 2;
  const monthlyCents = shared
    ? ratFrac(bill, householdSize)
    : ratFrac(bill * 100, PERSONS_PER_HOUSEHOLD.hundredths);
  const splitNote = shared
    ? `split ${householdSize} ways`
    : "divided by 2.55 persons per household (one person's share)";
  return {
    status: "estimate",
    monthlyCents,
    source: SOURCES.utilityBills,
    note: `${cityNote}, ${splitNote}. Household size source: ${SOURCES.householdSize.url}`,
  };
}

function caltrainPass(route: TransitRoute): PassLine | string {
  const zones: number[] = [];
  for (const leg of route.legs) {
    if (leg.mode !== "transit" || leg.agency?.toLowerCase() !== "caltrain") continue;
    const from = caltrainZone(leg.from);
    const to = caltrainZone(leg.to);
    if (from === null || to === null) {
      return `Caltrain zone is Unknown for ${leg.from ?? "Unknown"} to ${leg.to ?? "Unknown"}`;
    }
    zones.push(from, to);
  }
  const span = Math.max(...zones) - Math.min(...zones) + 1;
  const options = Object.entries(CALTRAIN_MONTHLY_PASS_CENTS)
    .map(([count, cents]) => ({ count: Number(count), cents }))
    .filter((option) => option.count >= span)
    .sort((a, b) => a.cents - b.cents);
  const best = options[0];
  if (!best) return `No Caltrain pass price in the pack covers ${span} zones`;
  return {
    agency: "caltrain",
    product: `Caltrain monthly pass, ${best.count} zone${best.count === 1 ? "" : "s"}`,
    cents: best.cents,
    source: SOURCES.caltrainFares,
  };
}

const FLAT_PASSES: Readonly<Record<string, Omit<PassLine, "agency">>> = {
  vta: { product: "VTA monthly pass", cents: VTA_MONTHLY_PASS_CENTS, source: SOURCES.vtaFares },
  samtrans: {
    product: "SamTrans monthly pass",
    cents: SAMTRANS_MONTHLY_PASS_CENTS,
    source: SOURCES.samtransFares,
  },
  marguerite: {
    product: "Stanford Marguerite (free)",
    cents: MARGUERITE_MONTHLY_CENTS,
    source: SOURCES.marguerite,
  },
};

function cheapestPass(route: TransitRoute): PassChoice {
  const transitLegs = route.legs.filter((leg) => leg.mode === "transit");
  if (transitLegs.length === 0) {
    return { status: "estimate", monthlyCents: 0, passes: [], reason: "No transit legs, so no pass is needed" };
  }
  const agencies = [...new Set(transitLegs.map((leg) => leg.agency?.toLowerCase() ?? ""))];
  const passes: PassLine[] = [];
  for (const agency of agencies) {
    if (agency === "caltrain") {
      const pass = caltrainPass(route);
      if (typeof pass === "string") return { status: "unknown", reason: pass };
      passes.push(pass);
      continue;
    }
    const flat = FLAT_PASSES[agency];
    if (!flat) {
      return { status: "unknown", reason: `No pass price for agency ${agency || "Unknown"} in the Bay Area pack` };
    }
    passes.push({ agency, ...flat });
  }
  const monthlyCents = passes.reduce((sum, pass) => sum + pass.cents, 0);
  return {
    status: "estimate",
    monthlyCents,
    passes,
    reason: passes.map((pass) => pass.product).join(" + "),
  };
}

function fixed(cents: number, source: Source, note: string): RegionAmount {
  return { status: "estimate", monthlyCents: ratInt(cents), source, note };
}

export const bayAreaPack: RegionPack = {
  id: "bay-area",
  name: "San Francisco Bay Area",
  hasData: true,
  utilitiesMonthly,
  internetMonthly: () => fixed(INTERNET_MONTHLY_CENTS, SOURCES.internet, "Single-person home internet"),
  rentersInsuranceMonthly: () =>
    fixed(RENTERS_INSURANCE_MONTHLY_CENTS, SOURCES.rentersInsurance, "California average policy"),
  cheapestPass,
};
