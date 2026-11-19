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

export type Provenance = (typeof PROVENANCE)[number];

export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  url: text("url"),
  rawText: text("raw_text"),
  type: text("type", { enum: LISTING_TYPES }),
  address: text("address"),
  lat: real("lat"),
  lng: real("lng"),
  city: text("city"),
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
  (table) => [uniqueIndex("facts_listing_field_idx").on(table.listingId, table.field)],
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
  },
  (table) => [index("photos_listing_idx").on(table.listingId)],
);
