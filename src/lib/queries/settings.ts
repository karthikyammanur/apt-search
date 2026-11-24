// Settings and scoring weights. Weights live in the `preferences` table (soft rows), as
// docs/design.md says, with who set them and their history; settings live in `settings`.

import { asc, eq } from "drizzle-orm";
import { SOFT_FACTORS, type SoftFactor } from "@/db/defaults";
import { listings, preferences } from "@/db/schema";
import { getSettings as readSettings, setSetting } from "@/db/settings";
import { settingsSchema, type Settings } from "@/db/settings-schema";
import { FACTOR_LABELS, type Weights } from "@/lib/domain";
import { recompute } from "@/lib/intake/analysis";
import { loadWeights } from "@/lib/intake/store";
import { getRegionPack } from "@/lib/regions";
import { dbOf, type QueryOptions } from "./shared";
import type { WriteResult } from "./leads";

export type WeightRow = {
  factor: SoftFactor;
  label: string;
  /** 0..1. All weights add up to 1. */
  weight: number;
  /** Null for the untouched starting weight. */
  setBy: "me" | "chat" | null;
};

export type AppSettings = { settings: Settings; weights: WeightRow[] };

/** Settings plus the current weights. Throws if the settings rows are missing (run the seed). */
export async function getSettings(options?: QueryOptions): Promise<AppSettings> {
  const db = dbOf(options);
  const settings = await readSettings(db);
  const weights = await loadWeights(db);
  const rows = await db.select().from(preferences).where(eq(preferences.kind, "soft"));
  const setBy = new Map(rows.map((row) => [row.key, row.setBy]));
  return {
    settings,
    weights: SOFT_FACTORS.map((factor) => ({
      factor,
      label: FACTOR_LABELS[factor],
      weight: weights[factor],
      setBy: setBy.get(factor) ?? null,
    })),
  };
}

/** Context the analysis needs, read fresh from the database. */
export async function analysisContext(options?: QueryOptions) {
  const db = dbOf(options);
  const settings = await readSettings(db);
  return {
    settings,
    weights: await loadWeights(db),
    region: getRegionPack(settings.region),
    now: options?.now ?? (() => new Date()),
  };
}

/** Re-run cost, filters and score for every listing from its stored facts. No map calls. */
export async function recheckAllListings(options?: QueryOptions): Promise<number> {
  const db = dbOf(options);
  const context = await analysisContext(options);
  const ids = await db.select({ id: listings.id }).from(listings).orderBy(asc(listings.id));
  for (const { id } of ids) await recompute(db, id, context);
  return ids.length;
}

/**
 * Change settings (validated by the shared schema), then recheck every listing. A change to the
 * office address does not recompute commutes here; that needs map calls and happens in intake.
 */
export async function updateSettings(
  patch: Partial<Settings>,
  options?: QueryOptions,
): Promise<WriteResult<{ settings: Settings; listingsRechecked: number }>> {
  const db = dbOf(options);
  const current = await readSettings(db);
  const parsed = settingsSchema.safeParse({ ...current, ...patch });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    await setSetting(db, key, parsed.data[key] as never);
  }
  const listingsRechecked = await recheckAllListings(options);
  return { ok: true, data: { settings: parsed.data, listingsRechecked } };
}

/** Write a full set of weights. Used by feedback events and their undo. */
export async function writeWeights(
  weights: Weights,
  setBy: "me" | "chat",
  note: { at: string; eventId?: number; undo?: boolean },
  options?: QueryOptions,
): Promise<void> {
  const db = dbOf(options);
  for (const factor of SOFT_FACTORS) {
    const [existing] = await db.select().from(preferences).where(eq(preferences.key, factor));
    const entry = { ...note, from: existing?.weight ?? null, to: weights[factor] };
    if (existing) {
      await db
        .update(preferences)
        .set({ weight: weights[factor], setBy, history: [...existing.history, entry] })
        .where(eq(preferences.key, factor));
    } else {
      await db.insert(preferences).values({ key: factor, kind: "soft", value: null, weight: weights[factor], setBy, history: [entry] });
    }
  }
}
