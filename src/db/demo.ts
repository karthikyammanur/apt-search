// Demo data for screens, chat and tests: 12 clearly fake listings (3 pass, 2 likely, 4 needs
// info, 3 fail), 3 roommate leads, channel runs, a few transit stops and the example settings.
// Every place, person and link is made up ("Sample St", example.com). Run: npm run db:seed:demo
//
// Only facts are written by hand. Bucket, score and every cost come from the real domain code
// (analyzeFacts), exactly as the intake pipeline stores them, so the demo cannot drift from the
// rules. Each listing names the bucket it is built to land in; seedDemo checks it.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "@libsql/client";
import { getTableName, sql } from "drizzle-orm";
import { SOFT_FACTORS, STARTING_WEIGHT } from "./defaults";
import type { Db } from "./index";
import {
  channelRuns,
  enrichment,
  facts as factsTable,
  feedbackEvents,
  listings,
  photos,
  preferences,
  roommateLeads,
  roommates,
  settings as settingsTable,
  transitStops,
  chatMessages,
  type CHANNELS,
  type Provenance,
} from "./schema";
import { settingsSchema, type Settings } from "./settings-schema";
import { SCAM_CHECK_IDS, type Bucket, type ListingFactValues, type ScamChecks } from "@/lib/domain";
import { analyzeFacts, enrichmentColumns } from "@/lib/intake/analysis";
import { loadFacts, saveFacts, type FactField, type FactWrite } from "@/lib/intake/facts";
import { loadWeights, saveEnrichment } from "@/lib/intake/store";
import { getRegionPack } from "@/lib/regions";

export const DEMO_GROUPS = ["Sample Bay Area Housing Group", "Sample Campus Sublets"] as const;

type FactValue = ListingFactValues[keyof ListingFactValues];
/** A value, or [value, provenance]. Plain values have provenance `listing`. */
type DemoFacts = Partial<Record<FactField, FactValue | [FactValue, Provenance]>>;

type DemoListing = {
  expect: Bucket;
  source: string;
  title: string;
  text: string;
  type: "room" | "studio" | "apartment";
  postType: "room_offered" | "whole_place_offered";
  address: string | null;
  city: string;
  lat: number | null;
  lng: number | null;
  groupName?: string;
  posterProfileUrl?: string;
  /** Hours before `now` the listing was first seen. */
  ageHours: number;
  facts: DemoFacts;
  /** Bike minutes and places, as enrichment would store them. Omit for a listing with no address. */
  map?: { bikeMinutes: number; grocery: [string, number]; gym: [string, number]; cafes: [string, number][] };
  photoCount: number;
  people?: { name: string; status: "Messaged" | "Call scheduled" | "Met" }[];
  userStatus?: "shortlisted" | "rejected";
  userStatusReason?: string;
};

const ALL_PASS = Object.fromEntries(SCAM_CHECK_IDS.map((id) => [id, "pass"])) as ScamChecks;
const ALL_OPEN = Object.fromEntries(SCAM_CHECK_IDS.map((id) => [id, null])) as ScamChecks;

const caltrain = (from: string, to: string) => ({
  legs: [
    { mode: "walk" as const },
    { mode: "transit" as const, agency: "caltrain", from, to },
    { mode: "walk" as const },
  ],
});
const bus = { legs: [{ mode: "walk" as const }, { mode: "transit" as const, agency: "vta" }, { mode: "walk" as const }] };

/** Everything a passing room needs: confirmed, no extra costs, a 7-month lease from Jan 2. */
const COMPLETE_ROOM: DemoFacts = {
  shortTermPremiumCents: 0,
  mandatoryFeesMonthlyCents: 0,
  utilitiesIncluded: true,
  householdSize: 3,
  internetIncluded: true,
  rentersInsuranceRequired: false,
  oneTimeFeesCents: 0,
  nonRefundableDepositCents: 0,
  lacksBasics: false,
  availableFrom: "2027-01-02",
  leaseType: "fixed",
  leaseMonths: 7,
  privateBedroom: true,
  privateBath: true,
  furnished: true,
  hasBed: true,
  hasDesk: true,
  hasChair: true,
  kitchenEquipped: true,
  hasRoommates: false,
  scamChecks: [ALL_PASS, "me"],
  reviews: { averageRating: 4.5, recentCount: 5 },
};

const NEAR_CALTRAIN = (walk: number, station = "California Ave"): DemoFacts => ({
  commuteMinutes: [18 + walk, "api"],
  commuteRoute: [caltrain(station, "Palo Alto"), "api"],
  nearbyStops: [[{ name: station, walkMinutes: walk, rushHeadwayMinutes: 20, regionalRail: true }], "api"],
  groceryWalkMinutes: [6, "api"],
  gymWalkMinutes: [9, "api"],
  cafeWalkMinutes: [[3, 6, 8], "estimate"],
});

const DEFAULT_MAP = {
  bikeMinutes: 14,
  grocery: ["Sample Market", 6] as [string, number],
  gym: ["Example Fitness", 9] as [string, number],
  cafes: [["Demo Cafe", 3], ["Sample Coffee", 6], ["Example Espresso", 8]] as [string, number][],
};

export const DEMO_LISTINGS: DemoListing[] = [
  {
    expect: "pass",
    source: "facebook_group",
    title: "Furnished room with private bath in a 3BR house (sample)",
    text: "Sample post. Furnished private room with its own bathroom in a 3BR house on Sample St. Two quiet roommates, happy to video call. Jan 2 for 7 months, $1,650 a month, utilities and wifi included, no fees.",
    type: "room",
    postType: "room_offered",
    address: "100 Sample St, Palo Alto, CA",
    city: "Palo Alto",
    lat: 37.4262,
    lng: -122.1435,
    groupName: DEMO_GROUPS[0],
    posterProfileUrl: "https://example.com/people/sample-poster-1",
    ageHours: 6,
    facts: {
      ...COMPLETE_ROOM,
      ...NEAR_CALTRAIN(5),
      type: "room",
      city: "Palo Alto",
      rentCents: 165000,
      refundableDepositCents: 165000,
      hasRoommates: true,
      canMeetRoommates: [true, "landlord"],
      utilitiesIncluded: [true, "landlord"],
    },
    map: DEFAULT_MAP,
    photoCount: 4,
    people: [
      { name: "Sample Roommate A", status: "Met" },
      { name: "Sample Roommate B", status: "Call scheduled" },
    ],
    userStatus: "shortlisted",
    userStatusReason: "Close to Caltrain and the roommates seem easy to live with",
  },
  {
    expect: "pass",
    source: "supost",
    title: "Furnished studio near campus, Jan to Aug (sample)",
    text: "Sample post. Furnished studio with kitchen, Jan 2 to Aug 31, $2,100 a month, utilities included.",
    type: "studio",
    postType: "whole_place_offered",
    address: "220 Example Ave, Palo Alto, CA",
    city: "Palo Alto",
    lat: 37.4419,
    lng: -122.1608,
    ageHours: 30,
    facts: {
      ...COMPLETE_ROOM,
      ...NEAR_CALTRAIN(8, "Palo Alto"),
      type: "studio",
      city: "Palo Alto",
      rentCents: 210000,
      refundableDepositCents: 210000,
      leaseMonths: 8,
    },
    map: { ...DEFAULT_MAP, bikeMinutes: 9 },
    photoCount: 3,
  },
  {
    expect: "pass",
    source: "example-rentals.test",
    title: "Private room and bath, month to month (sample)",
    text: "Sample page captured with the browser button. Private furnished room with en-suite bath, month to month from Jan 3, $1,900, utilities split three ways.",
    type: "room",
    postType: "room_offered",
    address: "35 Placeholder Ct, Menlo Park, CA",
    city: "Menlo Park",
    lat: 37.4528,
    lng: -122.1817,
    ageHours: 50,
    facts: {
      ...COMPLETE_ROOM,
      ...NEAR_CALTRAIN(7, "Menlo Park"),
      commuteRoute: [caltrain("Menlo Park", "Palo Alto"), "api"],
      type: "room",
      city: "Menlo Park",
      rentCents: 190000,
      refundableDepositCents: 100000,
      availableFrom: "2027-01-03",
      leaseType: "month_to_month",
      leaseMonths: undefined,
      // Utilities not included and no share stated: the region pack estimates it.
      utilitiesIncluded: false,
    },
    map: { ...DEFAULT_MAP, bikeMinutes: 16 },
    photoCount: 5,
  },
  {
    expect: "likely",
    source: "craigslist",
    title: "Room with private bath near downtown, fees not listed (sample)",
    text: "Sample alert email. Furnished room, private bath, Jan 2 for 7 months, $1,800. Ask about fees.",
    type: "room",
    postType: "room_offered",
    address: "48 Demo Rd, Palo Alto, CA",
    city: "Palo Alto",
    lat: 37.4456,
    lng: -122.1592,
    ageHours: 12,
    facts: {
      ...COMPLETE_ROOM,
      ...NEAR_CALTRAIN(6, "Palo Alto"),
      type: "room",
      city: "Palo Alto",
      rentCents: 180000,
      mandatoryFeesMonthlyCents: undefined,
      oneTimeFeesCents: undefined,
      scamChecks: [ALL_OPEN, "estimate"],
    },
    map: DEFAULT_MAP,
    photoCount: 2,
  },
  {
    expect: "likely",
    source: "zillow",
    title: "Furnished studio, deposit terms to confirm (sample)",
    text: "Sample alert email. Furnished studio, Jan 1 for 8 months, $2,000 a month, utilities included.",
    type: "studio",
    postType: "whole_place_offered",
    address: "7 Sample Way, Mountain View, CA",
    city: "Mountain View",
    lat: 37.3947,
    lng: -122.0763,
    ageHours: 70,
    facts: {
      ...COMPLETE_ROOM,
      ...NEAR_CALTRAIN(4, "Mountain View"),
      commuteMinutes: [26, "api"],
      commuteRoute: [caltrain("Mountain View", "Palo Alto"), "api"],
      type: "studio",
      city: "Mountain View",
      rentCents: 200000,
      availableFrom: "2027-01-01",
      leaseMonths: 8,
      nonRefundableDepositCents: undefined,
      oneTimeFeesCents: undefined,
    },
    map: { ...DEFAULT_MAP, bikeMinutes: 25 },
    photoCount: 3,
  },
  {
    expect: "needs_info",
    source: "rentcast",
    title: "1 bed apartment, furniture not stated (sample)",
    text: "Sample API record. 1 bed 1 bath apartment, $2,300 a month.",
    type: "apartment",
    postType: "whole_place_offered",
    address: "900 Example Blvd, Palo Alto, CA",
    city: "Palo Alto",
    lat: 37.4183,
    lng: -122.1351,
    ageHours: 20,
    facts: {
      ...NEAR_CALTRAIN(9),
      type: "apartment",
      city: "Palo Alto",
      rentCents: 230000,
      privateBedroom: true,
      privateBath: true,
      hasRoommates: false,
    },
    map: DEFAULT_MAP,
    photoCount: 1,
  },
  {
    expect: "needs_info",
    source: "paste",
    title: "Room in a shared house, bathroom not stated (sample)",
    text: "Sample pasted text. Furnished room in a 4BR house on Demo Rd, $1,500, available Jan 5, 7-month lease.",
    type: "room",
    postType: "room_offered",
    address: "12 Demo Rd, Palo Alto, CA",
    city: "Palo Alto",
    lat: 37.4301,
    lng: -122.1288,
    ageHours: 100,
    facts: {
      ...COMPLETE_ROOM,
      commuteMinutes: [24, "api"],
      commuteRoute: [bus, "api"],
      nearbyStops: [[{ name: "Sample St & Example Ave", walkMinutes: 3, rushHeadwayMinutes: 15, regionalRail: false }], "api"],
      type: "room",
      city: "Palo Alto",
      rentCents: 150000,
      availableFrom: "2027-01-05",
      privateBath: undefined,
      hasRoommates: true,
      canMeetRoommates: true,
    },
    map: DEFAULT_MAP,
    photoCount: 0,
  },
  {
    expect: "needs_info",
    source: "hotpads",
    title: "Studio with flexible dates, lease terms not listed (sample)",
    text: "Sample alert email. Furnished studio, $2,250 a month.",
    type: "studio",
    postType: "whole_place_offered",
    address: "61 Placeholder Ln, Redwood City, CA",
    city: "Redwood City",
    lat: 37.4848,
    lng: -122.2281,
    ageHours: 140,
    facts: {
      ...COMPLETE_ROOM,
      ...NEAR_CALTRAIN(6, "Redwood City"),
      commuteMinutes: [29, "api"],
      commuteRoute: [caltrain("Redwood City", "Palo Alto"), "api"],
      type: "studio",
      city: "Redwood City",
      rentCents: 225000,
      availableFrom: undefined,
      leaseType: undefined,
      leaseMonths: undefined,
    },
    map: { ...DEFAULT_MAP, bikeMinutes: 32 },
    photoCount: 2,
  },
  {
    expect: "needs_info",
    source: "supost",
    title: "Room in a 3BR, roommates to meet (sample)",
    text: "Sample post. Room for rent near campus, $1,400.",
    type: "room",
    postType: "room_offered",
    address: null,
    city: "Palo Alto",
    lat: null,
    lng: null,
    ageHours: 8,
    facts: { type: "room", city: "Palo Alto", rentCents: 140000, hasRoommates: true, scamChecks: [ALL_OPEN, "estimate"] },
    photoCount: 0,
  },
  {
    expect: "fail",
    source: "rentcast",
    title: "2 bed apartment over budget (sample)",
    text: "Sample API record. 2 bed 2 bath apartment, $3,200 a month.",
    type: "apartment",
    postType: "whole_place_offered",
    address: "4 Example Plaza, Palo Alto, CA",
    city: "Palo Alto",
    lat: 37.4372,
    lng: -122.1561,
    ageHours: 40,
    facts: { ...NEAR_CALTRAIN(5, "Palo Alto"), type: "apartment", city: "Palo Alto", rentCents: 320000, hasRoommates: false },
    map: DEFAULT_MAP,
    photoCount: 2,
  },
  {
    expect: "fail",
    source: "supost",
    title: "Sublet that ends in May (sample)",
    text: "Sample post. Furnished room, sublet Jan 2 to May 31, $1,300.",
    type: "room",
    postType: "room_offered",
    address: null,
    city: "Palo Alto",
    lat: null,
    lng: null,
    ageHours: 16,
    facts: {
      type: "room",
      city: "Palo Alto",
      rentCents: 130000,
      furnished: true,
      availableFrom: "2027-01-02",
      leaseType: "sublet",
      leaseEnd: "2027-05-31",
    },
    photoCount: 1,
    userStatus: "rejected",
    userStatusReason: "Ends three months too early",
  },
  {
    expect: "fail",
    source: "facebook_group",
    title: "Room with a shared bathroom (sample)",
    text: "Sample post. Furnished room, shared bathroom with one other person, $1,200, Jan 2 for 7 months.",
    type: "room",
    postType: "room_offered",
    address: "300 Sample St, Palo Alto, CA",
    city: "Palo Alto",
    lat: 37.4239,
    lng: -122.1412,
    groupName: DEMO_GROUPS[1],
    posterProfileUrl: "https://example.com/people/sample-poster-2",
    ageHours: 26,
    facts: { ...COMPLETE_ROOM, ...NEAR_CALTRAIN(5), type: "room", city: "Palo Alto", rentCents: 120000, privateBath: false },
    map: DEFAULT_MAP,
    photoCount: 1,
  },
];

const DEMO_STOPS = [
  { stopId: "demo-cal-ave", name: "California Ave", lat: 37.4291, lng: -122.1419, modes: ["rail"], departures: 8, headway: 20, basis: "target_date" as const },
  { stopId: "demo-palo-alto", name: "Palo Alto", lat: 37.4433, lng: -122.1649, modes: ["rail"], departures: 10, headway: 15, basis: "target_date" as const },
  { stopId: "demo-menlo-park", name: "Menlo Park", lat: 37.4545, lng: -122.1823, modes: ["rail"], departures: 8, headway: 20, basis: "target_date" as const },
  { stopId: "demo-mountain-view", name: "Mountain View", lat: 37.3946, lng: -122.0764, modes: ["rail"], departures: 9, headway: 18, basis: "target_date" as const },
  { stopId: "demo-redwood-city", name: "Redwood City", lat: 37.4855, lng: -122.2318, modes: ["rail"], departures: 9, headway: 18, basis: "target_date" as const },
  { stopId: "demo-bus-1", name: "Sample St & Example Ave", lat: 37.4305, lng: -122.1291, modes: ["bus"], departures: 8, headway: 15, basis: "current_schedule" as const },
];

const DEMO_LEADS = [
  {
    source: "facebook_group",
    posterName: "Sample Person A",
    groupName: DEMO_GROUPS[0],
    text: "Sample post. Intern starting in January, looking for someone to share a 2 bed 2 bath near Caltrain, Jan to Aug.",
    datesWanted: "Jan to Aug 2027",
    budgetCents: 160000,
    status: "talking" as const,
    notes: "Video call done, seems a good fit",
    ageHours: 30,
  },
  {
    source: "facebook_group",
    posterName: "Sample Person B",
    groupName: DEMO_GROUPS[1],
    text: "Sample post. Looking for a roommate for a furnished 2BR in Mountain View from January.",
    datesWanted: "From January 2027",
    budgetCents: null,
    status: "messaged" as const,
    notes: null,
    ageHours: 60,
  },
  {
    source: "supost",
    posterName: null,
    groupName: null,
    text: "Sample post. Grad student seeks a roommate to split a 2B2B, Jan 5 to Aug 15.",
    datesWanted: "Jan 5 to Aug 15",
    budgetCents: 150000,
    status: "new" as const,
    notes: null,
    ageHours: 5,
  },
];

type DemoRun = { channel: (typeof CHANNELS)[number]; groupName?: string; ageHours: number; seen: number; fresh: number; error?: string };
const DEMO_RUNS: DemoRun[] = [
  { channel: "supost", ageHours: 2, seen: 90, fresh: 3 },
  { channel: "supost", ageHours: 26, seen: 88, fresh: 2 },
  { channel: "gmail_alerts", ageHours: 2, seen: 6, fresh: 2 },
  { channel: "rentcast", ageHours: 2, seen: 0, fresh: 0, error: "disabled (sample: API key not active)" },
  { channel: "extension", ageHours: 50, seen: 1, fresh: 1 },
  { channel: "facebook_capture", groupName: DEMO_GROUPS[0], ageHours: 26, seen: 14, fresh: 2 },
  { channel: "facebook_capture", groupName: DEMO_GROUPS[1], ageHours: 3, seen: 9, fresh: 1 },
];

export const EXAMPLE_SETTINGS_PATH = path.join("config", "settings.example.json");

/** The example settings only. The demo never reads the private settings file. */
export function exampleSettings(root: string = process.cwd()): Settings {
  return settingsSchema.parse(JSON.parse(readFileSync(path.join(root, EXAMPLE_SETTINGS_PATH), "utf8")));
}

export type DemoSeedResult = {
  listings: number;
  buckets: Record<Bucket, number>;
  roommateLeads: number;
  channelRuns: number;
  transitStops: number;
};

const hoursBefore = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

/**
 * Delete every row the demo writes, so a reset starts from empty. The AUTOINCREMENT counters
 * are reset too, so a reset seed always gives the same ids (the e2e specs reseed between files).
 */
async function clearDemoTables(db: Db): Promise<void> {
  const tables = [chatMessages, feedbackEvents, photos, roommates, factsTable, enrichment, listings, roommateLeads, channelRuns, transitStops, preferences, settingsTable];
  for (const table of tables) {
    await db.delete(table);
  }
  const hasSequence = await db.all(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`);
  if (hasSequence.length === 0) return;
  for (const table of tables) {
    await db.run(sql`DELETE FROM sqlite_sequence WHERE name = ${getTableName(table)}`);
  }
}

/**
 * The protocol of the open connection: "file" for a local SQLite file or memory, "http" or "ws"
 * for a remote database such as Turso. drizzle sets `$client`; the `Db` type leaves it out.
 */
export function databaseProtocol(db: Db): string {
  return (db as Db & { $client: Client }).$client.protocol;
}

/**
 * Write the demo data into a migrated database. Refuses a database that already has listings
 * unless `reset` is set, which first deletes every listing, lead, run, stop, weight and setting.
 * Seeding, with or without reset, runs only on a local SQLite file (or memory), never on a
 * remote database such as Turso: demo data must never reach production.
 */
export async function seedDemo(
  db: Db,
  options: { now?: Date; reset?: boolean; root?: string } = {},
): Promise<DemoSeedResult> {
  // Checked on the open connection, before any query, so it holds whatever URL opened it.
  const protocol = databaseProtocol(db);
  if (protocol !== "file") {
    throw new Error(`Refusing to seed demo data into a remote database (protocol "${protocol}"). The demo seed runs only on a local file.`);
  }
  const now = options.now ?? new Date();
  const existing = await db.select({ id: listings.id }).from(listings).limit(1);
  if (existing.length > 0) {
    if (!options.reset) throw new Error("The database already has listings. Use an empty database, or pass --reset to replace everything.");
  }
  if (options.reset) await clearDemoTables(db);

  const settings = exampleSettings(options.root);
  const stamp = now.toISOString();
  for (const [key, value] of Object.entries(settings)) {
    await db.insert(settingsTable).values({ key, value, updatedAt: stamp }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: stamp } });
  }
  for (const factor of SOFT_FACTORS) {
    await db.insert(preferences).values({ key: factor, kind: "soft", value: null, weight: STARTING_WEIGHT, setBy: null }).onConflictDoNothing();
  }
  const weights = await loadWeights(db);
  const region = getRegionPack(settings.region);

  for (const stop of DEMO_STOPS) {
    await db.insert(transitStops).values({
      feed: "demo",
      stopId: stop.stopId,
      name: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      modes: stop.modes,
      weekdayRushDepartures: stop.departures,
      medianRushHeadwayMin: stop.headway,
      scheduleBasis: stop.basis,
      scheduleDate: stop.basis === "current_schedule" ? "2027-01-05" : "2027-01-12",
      computedAt: stamp,
    });
  }

  const buckets: Record<Bucket, number> = { pass: 0, likely: 0, needs_info: 0, fail: 0 };
  for (const [index, demo] of DEMO_LISTINGS.entries()) {
    const firstSeen = hoursBefore(now, demo.ageHours);
    const url = `https://example.com/demo-listings/${index + 1}`;
    const [row] = await db
      .insert(listings)
      .values({
        source: demo.source,
        url,
        rawText: demo.text,
        title: demo.title,
        type: demo.type,
        postType: demo.postType,
        address: demo.address,
        lat: demo.lat,
        lng: demo.lng,
        city: demo.city,
        groupName: demo.groupName ?? null,
        posterProfileUrl: demo.posterProfileUrl ?? null,
        sourceLinks: [{ source: demo.source, url, seen_at: firstSeen }],
        status: "New",
        userStatus: demo.userStatus ?? "none",
        userStatusReason: demo.userStatusReason ?? null,
        firstSeen,
        lastChecked: stamp,
      })
      .returning({ id: listings.id });
    if (!row) throw new Error("Demo listing insert returned no row");

    const writes: FactWrite[] = Object.entries(demo.facts).flatMap(([field, entry]): FactWrite[] => {
      const [value, provenance] = Array.isArray(entry) && entry.length === 2 && typeof entry[1] === "string" && ["listing", "landlord", "estimate", "api", "me"].includes(entry[1])
        ? (entry as [FactValue, Provenance])
        : [entry as FactValue, "listing" as Provenance];
      return value === undefined ? [] : [{ field: field as FactField, value, provenance, sourceUrl: provenance === "listing" ? url : null }];
    });
    await saveFacts(db, row.id, writes, firstSeen);

    for (let p = 0; p < demo.photoCount; p++) {
      await db.insert(photos).values({ listingId: row.id, url: `https://example.com/demo-photos/${index + 1}-${p + 1}.jpg`, position: p, source: demo.source });
    }
    for (const person of demo.people ?? []) {
      await db.insert(roommates).values({ listingId: row.id, name: person.name, status: person.status });
    }

    const facts = await loadFacts(db, row.id);
    const analysis = analyzeFacts(facts, settings, weights, region);
    if (analysis.bucket !== demo.expect) {
      const reasons = analysis.filters.results.filter((r) => r.status !== "pass").map((r) => `${r.filter}: ${r.reason}`);
      throw new Error(`Demo listing ${index + 1} landed in ${analysis.bucket}, not ${demo.expect} (${reasons.join("; ")})`);
    }
    buckets[analysis.bucket] += 1;
    const stops = facts.nearbyStops?.value ?? [];
    const scam = facts.scamChecks?.value ?? null;
    const map = demo.map;
    await saveEnrichment(
      db,
      row.id,
      {
        ...enrichmentColumns(analysis, scam ? { checks: scam, details: SCAM_CHECK_IDS.map((id) => ({ id, status: scam[id] === "resolved" ? "pass" : scam[id], reason: scam[id] === null ? "Not checked yet (sample)" : "Checked by hand (sample)" })), medianCents: null } : null),
        commuteTransitMin: facts.commuteMinutes?.value ?? null,
        routeSteps: facts.commuteRoute ? facts.commuteRoute.value.legs.map((leg) => ({ mode: leg.mode.toUpperCase(), lineName: leg.agency === "caltrain" ? "Local" : leg.agency === "vta" ? "22" : null, minutes: leg.mode === "transit" ? 12 : 4 })) : null,
        commuteBikeMin: map?.bikeMinutes ?? null,
        nearestStop: stops[0]?.name ?? null,
        stopWalkMin: stops[0]?.walkMinutes ?? null,
        rushHeadwayMin: stops[0]?.rushHeadwayMinutes ?? null,
        pois: map
          ? {
              grocery: { name: map.grocery[0], walkMinutes: map.grocery[1], provenance: "api" },
              gym: { name: map.gym[0], walkMinutes: map.gym[1], provenance: "api" },
              cafes: map.cafes.map(([name, walkMinutes], i) => ({ name, walkMinutes, provenance: i === 0 ? "api" : "estimate" })),
            }
          : null,
      },
      stamp,
    );
  }

  for (const [index, lead] of DEMO_LEADS.entries()) {
    await db.insert(roommateLeads).values({
      source: lead.source,
      postUrl: `https://example.com/demo-leads/${index + 1}`,
      posterName: lead.posterName,
      posterProfileUrl: lead.posterName ? `https://example.com/people/sample-lead-${index + 1}` : null,
      groupName: lead.groupName,
      text: lead.text,
      datesWanted: lead.datesWanted,
      budgetCents: lead.budgetCents,
      status: lead.status,
      notes: lead.notes,
      createdAt: hoursBefore(now, lead.ageHours),
    });
  }
  for (const run of DEMO_RUNS) {
    await db.insert(channelRuns).values({
      channel: run.channel,
      groupName: run.groupName ?? null,
      ranAt: hoursBefore(now, run.ageHours),
      itemsSeen: run.seen,
      itemsNew: run.fresh,
      error: run.error ?? null,
    });
  }

  return {
    listings: DEMO_LISTINGS.length,
    buckets,
    roommateLeads: DEMO_LEADS.length,
    channelRuns: DEMO_RUNS.length,
    transitStops: DEMO_STOPS.length,
  };
}
