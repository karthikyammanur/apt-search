// Drizzle schema for every table in docs/design.md "Data model".
//
// Conventions: money is integer cents, durations are integer minutes, dates are ISO text
// (YYYY-MM-DD) and timestamps are ISO 8601 text. Lists and structured values are JSON text.
// Unknown stays null; nothing here defaults a missing value to 0.

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { SourceLink } from "./source-links";

export const LISTING_TYPES = ["room", "studio", "apartment"] as const;
export const LISTING_STATUSES = [
  "New",
  "Interested",
  "Contacted",
  "Video tour",
  "Applied",
  "Rejected",
] as const;
/** Where a fact came from. Golden rule 2: every fact has one of these. */
export const PROVENANCE = ["listing", "landlord", "estimate", "api", "me"] as const;
export const PREFERENCE_KINDS = ["hard", "soft"] as const;
export const PREFERENCE_SET_BY = ["me", "chat"] as const;
export const FEEDBACK_VERDICTS = ["up", "down"] as const;
export const ROOMMATE_STATUSES = ["Messaged", "Call scheduled", "Met"] as const;
export const CHAT_ROLES = ["user", "assistant", "system", "tool"] as const;
/** What a captured post turned out to be. "unknown" until the classifier has run. */
export const POST_TYPES = [
  "room_offered",
  "whole_place_offered",
  "roommate_wanted",
  "unknown",
] as const;
export const LEAD_STATUSES = ["new", "messaged", "talking", "not_a_fit"] as const;
export const CHANNELS = [
  "supost",
  "gmail_alerts",
  "rentcast",
  "extension",
  "facebook_capture",
  "apify",
] as const;

export type Provenance = (typeof PROVENANCE)[number];

export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  url: text("url"),
  rawText: text("raw_text"),
  type: text("type", { enum: LISTING_TYPES }),
  postType: text("post_type", { enum: POST_TYPES }).notNull().default("unknown"),
  address: text("address"),
  lat: real("lat"),
  lng: real("lng"),
  city: text("city"),
  /** Facebook posts only. */
  groupName: text("group_name"),
  posterProfileUrl: text("poster_profile_url"),
  /** Every place this listing was seen, once duplicates are merged. See source-links.ts. */
  sourceLinks: text("source_links", { mode: "json" })
    .$type<SourceLink[]>()
    .notNull()
    .default(sql`'[]'`),
  status: text("status", { enum: LISTING_STATUSES }).notNull().default("New"),
  firstSeen: text("first_seen").notNull(),
  lastChecked: text("last_checked"),
});

export const facts = sqliteTable(
  "facts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    /** JSON value. Null means the field is unknown. Money inside is integer cents. */
    value: text("value", { mode: "json" }),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    sourceUrl: text("source_url"),
    checkedAt: text("checked_at").notNull(),
  },
  // One row per source of truth, so a landlord's answer never erases what the listing said.
  // Pick the current value with pickCurrentFact (facts.ts).
  (table) => [
    uniqueIndex("facts_listing_field_provenance_idx").on(
      table.listingId,
      table.field,
      table.provenance,
    ),
  ],
);

export const enrichment = sqliteTable("enrichment", {
  listingId: integer("listing_id")
    .primaryKey()
    .references(() => listings.id, { onDelete: "cascade" }),
  commuteTransitMin: integer("commute_transit_min"),
  routeSteps: text("route_steps", { mode: "json" }),
  commuteBikeMin: integer("commute_bike_min"),
  nearestStop: text("nearest_stop"),
  stopWalkMin: integer("stop_walk_min"),
  rushHeadwayMin: integer("rush_headway_min"),
  pois: text("pois", { mode: "json" }),
  costBreakdown: text("cost_breakdown", { mode: "json" }),
  /** Integer cents. */
  allInMonthly: integer("all_in_monthly"),
  /** Integer cents. */
  allInPlusTransit: integer("all_in_plus_transit"),
  scamChecks: text("scam_checks", { mode: "json" }),
  reviewSummary: text("review_summary", { mode: "json" }),
  computedAt: text("computed_at").notNull(),
});

/** Editable inputs (office address, dates, budget cap...). One row per key, JSON value. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const preferences = sqliteTable("preferences", {
  key: text("key").primaryKey(),
  kind: text("kind", { enum: PREFERENCE_KINDS }).notNull(),
  value: text("value", { mode: "json" }),
  /** Soft preferences only. Null for hard rules. */
  weight: real("weight"),
  /** Null means a starting default that neither I nor the chat has touched. */
  setBy: text("set_by", { enum: PREFERENCE_SET_BY }),
  history: text("history", { mode: "json" })
    .$type<unknown[]>()
    .notNull()
    .default(sql`'[]'`),
});

export const feedback = sqliteTable(
  "feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    verdict: text("verdict", { enum: FEEDBACK_VERDICTS }).notNull(),
    myWords: text("my_words"),
    weightChanges: text("weight_changes", { mode: "json" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("feedback_listing_idx").on(table.listingId)],
);

export const roommates = sqliteTable(
  "roommates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status", { enum: ROOMMATE_STATUSES }).notNull().default("Messaged"),
    notes: text("notes"),
  },
  (table) => [index("roommates_listing_idx").on(table.listingId)],
);

export const chat = sqliteTable("chat", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role", { enum: CHAT_ROLES }).notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
  /** For a rolling summary row: the chat ids it summarizes. Null for ordinary messages. */
  summaryOf: text("summary_of", { mode: "json" }).$type<number[]>(),
});

export const apiCache = sqliteTable(
  "api_cache",
  {
    provider: text("provider").notNull(),
    requestHash: text("request_hash").notNull(),
    response: text("response").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.requestHash] })],
);

/** Image links only. The server never downloads the images. */
export const photos = sqliteTable(
  "photos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    position: integer("position").notNull().default(0),
    source: text("source").notNull(),
    /** Perceptual hash for the duplicate-photo check. Null until computed. */
    phash: text("phash"),
  },
  (table) => [index("photos_listing_idx").on(table.listingId)],
);

/** Posts from people looking for a roommate. They are not listings. */
export const roommateLeads = sqliteTable("roommate_leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  postUrl: text("post_url"),
  posterName: text("poster_name"),
  posterProfileUrl: text("poster_profile_url"),
  groupName: text("group_name"),
  text: text("text"),
  datesWanted: text("dates_wanted"),
  /** Integer cents. Null when the post names no budget. */
  budgetCents: integer("budget_cents"),
  status: text("status", { enum: LEAD_STATUSES }).notNull().default("new"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

/** One row per channel run: feeds the daily per-channel counts and "last captured" times. */
export const channelRuns = sqliteTable(
  "channel_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    groupName: text("group_name"),
    ranAt: text("ran_at").notNull(),
    itemsSeen: integer("items_seen").notNull(),
    itemsNew: integer("items_new").notNull(),
    error: text("error"),
  },
  (table) => [index("channel_runs_channel_ran_idx").on(table.channel, table.ranAt)],
);

/** Rush-hour service per transit stop. Filled by the step 3 GTFS job, and only by it. */
export const transitStops = sqliteTable(
  "transit_stops",
  {
    stopId: text("stop_id").notNull(),
    feed: text("feed").notNull(),
    name: text("name").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    modes: text("modes", { mode: "json" }).$type<string[]>().notNull(),
    weekdayRushDepartures: integer("weekday_rush_departures").notNull(),
    /** Null when the stop has too few rush-hour departures to have a headway. */
    medianRushHeadwayMin: integer("median_rush_headway_min"),
    computedAt: text("computed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.feed, table.stopId] })],
);

/** Failed password attempts, kept in the database because serverless functions share no memory. */
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientKey: text("client_key").notNull(),
    attemptedAt: text("attempted_at").notNull(),
  },
  (table) => [index("login_attempts_client_idx").on(table.clientKey, table.attemptedAt)],
);
