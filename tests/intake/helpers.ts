// Test helpers for the intake pipeline: an in-memory migrated database, a stub model that returns
// canned extractions, stub map services that count their calls, and the fixture loaders.
// Nothing here touches the network.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import example from "../../config/settings.example.json";
import { createDb, type Db } from "@/db";
import { runMigrations } from "@/db/run-migrations";
import { transitStops } from "@/db/schema";
import { settingsSchema } from "@/db/settings-schema";
import { SOFT_FACTORS } from "@/db/defaults";
import type { Weights } from "@/lib/domain";
import { getRegionPack } from "@/lib/regions";
import type { Geo, Place } from "@/lib/intake/geo";
import type { Extraction } from "@/lib/intake/schema";
import type { IntakeDeps } from "@/lib/intake/pipeline";
import type { EmailInput } from "@/lib/intake/channels/email";
import type { LlmResult } from "@/lib/llm";

const FIXTURES = fileURLToPath(new URL("../fixtures/intake/", import.meta.url));

export const settings = settingsSchema.parse(example);
export const NOW = new Date("2026-11-23T12:00:00Z");

export const readFixture = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf8");
export const jsonFixture = <T = unknown>(name: string): T => JSON.parse(readFixture(name)) as T;

type EmailIndexEntry = { id: string; file: string; from: string; subject: string };
export function emailFixture(id: string): EmailInput {
  const entry = jsonFixture<EmailIndexEntry[]>("emails.json").find((e) => e.id === id);
  if (!entry) throw new Error(`No email fixture ${id}`);
  return {
    id: entry.id,
    headers: [
      { name: "From", value: entry.from },
      { name: "Subject", value: entry.subject },
    ],
    plainText: null,
    html: readFixture(entry.file),
  };
}

/** Build a model reply. Only post_type is required, like the real schema. */
export const extraction = (over: Partial<Extraction> & Pick<Extraction, "post_type">): Extraction => over as Extraction;

export type Canned = { match: string; value: Extraction };

/** A stub model: the first entry whose `match` text appears in the prompt supplies the reply. */
export function stubLlm(table: Canned[]) {
  const prompts: string[] = [];
  const llm: IntakeDeps["llm"] = {
    async generateStructured<T>(schema: z.ZodType<T>, prompt: string): Promise<LlmResult<T>> {
      prompts.push(prompt);
      const hit = table.find((entry) => prompt.includes(entry.match));
      if (!hit) return { ok: false, error: "all_providers_failed", detail: "no canned reply" };
      const parsed = schema.safeParse(hit.value);
      return parsed.success
        ? { ok: true, data: parsed.data, provider: "gemini" }
        : { ok: false, error: "invalid_output", detail: "canned reply does not match the schema" };
    },
  };
  return { llm, prompts };
}

export const OFFICE = { lat: 37.4419, lng: -122.143 };
export const HOME = { lat: 37.4, lng: -122.1 };

const PLACES: Place[] = [
  { id: "g1", name: "Test Market", lat: HOME.lat + 0.004, lng: HOME.lng, types: ["grocery_store"], rating: 4.2 },
  { id: "g2", name: "Far Market", lat: HOME.lat + 0.01, lng: HOME.lng, types: ["grocery_store"], rating: 4.0 },
  { id: "y1", name: "Test Gym", lat: HOME.lat, lng: HOME.lng + 0.006, types: ["gym"], rating: 4.5 },
  { id: "c1", name: "Cafe One", lat: HOME.lat + 0.002, lng: HOME.lng, types: ["cafe"], rating: 4.4 },
  { id: "c2", name: "Cafe Two", lat: HOME.lat, lng: HOME.lng + 0.003, types: ["cafe"], rating: 4.1 },
];

/** Stub map services. Every call is counted and its arguments recorded. */
export function stubGeo() {
  const calls = { geocode: [] as string[], transit: 0, walkBike: [] as string[], places: 0 };
  const geo: Geo = {
    async geocode(address) {
      calls.geocode.push(address);
      const point = address === settings.officeAddress ? OFFICE : HOME;
      return { ok: true, data: { ...point, address: `${address}, USA`.replace(/, CA, USA$/, ", CA 94000, USA") } };
    },
    async transit() {
      calls.transit += 1;
      return {
        ok: true,
        data: {
          minutes: 24,
          steps: [
            { mode: "WALK", lineName: null, minutes: 6 },
            { mode: "TRANSIT", lineName: "Caltrain Local", minutes: 12 },
            { mode: "WALK", lineName: null, minutes: 6 },
          ],
        },
      };
    },
    async walkBike(_from, _to, mode) {
      calls.walkBike.push(mode);
      return { ok: true, data: { minutes: mode === "BICYCLE" ? 18 : 7, steps: [] } };
    },
    async places() {
      calls.places += 1;
      return { ok: true, data: PLACES };
    },
  };
  return { geo, calls };
}

export function equalWeights(): Weights {
  return Object.fromEntries(SOFT_FACTORS.map((f) => [f, 1 / SOFT_FACTORS.length])) as Weights;
}

export async function makeDb(options: { stops?: boolean } = {}): Promise<Db> {
  const db = createDb(":memory:");
  await runMigrations(db);
  if (options.stops !== false) {
    await db.insert(transitStops).values({
      stopId: "s1",
      feed: "caltrain",
      name: "Test Station",
      lat: HOME.lat + 0.003,
      lng: HOME.lng,
      modes: ["rail"],
      weekdayRushDepartures: 20,
      medianRushHeadwayMin: 15,
      computedAt: NOW.toISOString(),
    });
  }
  return db;
}

export async function makeDeps(
  table: Canned[],
  options: { db?: Db; stops?: boolean } = {},
) {
  const db = options.db ?? (await makeDb({ stops: options.stops }));
  const model = stubLlm(table);
  const map = stubGeo();
  const deps: IntakeDeps = {
    db,
    settings,
    weights: equalWeights(),
    region: getRegionPack(settings.region),
    llm: model.llm,
    geo: map.geo,
    now: () => NOW,
    memo: {},
  };
  return { deps, db, prompts: model.prompts, calls: map.calls };
}

/** The canned model replies for the six fixtures. Each match is text that is in only that fixture. */
export const FIXTURE_REPLIES: Canned[] = [
  {
    match: "340 Cedar Ln",
    value: extraction({
      post_type: "room_offered",
      type: "room",
      address: "340 Cedar Ln, Palo Alto, CA 94306",
      city: "Palo Alto",
      rent_usd: 1950,
      utilities_included: true,
      internet_included: true,
      mandatory_fees_monthly_usd: 0,
      one_time_fees_usd: 0,
      available_from: "2027-01-04",
      lease_type: "fixed",
      lease_months: 7,
      private_bedroom: true,
      private_bath: true,
      furnished: true,
      has_bed: true,
      has_desk: true,
      has_chair: true,
    }),
  },
  {
    match: "410 Oak St",
    value: extraction({
      post_type: "whole_place_offered",
      type: "studio",
      address: "410 Oak St, Menlo Park, CA 94025",
      city: "Menlo Park",
      rent_usd: 2350,
      utilities_included: true,
      furnished: true,
      available_from: "2027-01-02",
    }),
  },
  {
    match: "77 Birch Way",
    value: extraction({
      post_type: "whole_place_offered",
      type: "apartment",
      address: "77 Birch Way, Mountain View, CA 94041",
      city: "Mountain View",
      rent_usd: 3900,
      furnished: false,
    }),
  },
  {
    match: "220 Pine St",
    value: extraction({
      post_type: "room_offered",
      type: "room",
      address: "220 Pine St, Sunnyvale, CA",
      city: "Sunnyvale",
      rent_usd: 1800,
      utilities_included: true,
      mandatory_fees_monthly_usd: 0,
      one_time_fees_usd: 0,
      private_bath: true,
      furnished: true,
      lease_type: "sublet",
    }),
  },
  {
    match: "Furnished room near campus",
    value: extraction({ post_type: "room_offered", type: "room", private_bath: true, furnished: true, rent_usd: 1700 }),
  },
  {
    match: "15 Willow Rd",
    value: extraction({
      post_type: "room_offered",
      type: "room",
      address: "15 Willow Rd, Redwood City, CA 94061",
      city: "Redwood City",
      rent_usd: 2200,
      refundable_deposit_usd: 300,
      utilities_included: true,
      internet_included: true,
      private_bedroom: true,
      private_bath: true,
      furnished: true,
      has_bed: true,
      has_desk: true,
      has_chair: true,
      kitchen_equipped: true,
      lease_type: "month_to_month",
      available_from: "2027-01-03",
      has_roommates: true,
    }),
  },
  {
    match: "400 Maple Ave",
    value: extraction({
      post_type: "room_offered",
      type: "room",
      address: "400 Maple Ave, Mountain View, CA 94040",
      city: "Mountain View",
      rent_usd: 2100,
      private_bath: true,
      has_bed: true,
      has_desk: true,
      has_chair: true,
      utilities_included: true,
      available_from: "2027-01-05",
    }),
  },
  {
    match: "Looking for a roommate",
    value: extraction({ post_type: "roommate_wanted", dates_wanted: "Jan to Aug", budget_usd: 2400 }),
  },
];
