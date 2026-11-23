// Stage: cost, filters, score. Calls the pure domain functions and nothing else, so no number
// here comes from a model. The result is stored in `enrichment.cost_breakdown` as one versioned
// envelope, because the table has no bucket or score column (a step 1 change, see PROGRESS.md).
//
// Readers (the chat tools and the screens) should call `readAnalysis`, which validates the
// envelope, rather than reading the JSON directly.

import { eq } from "drizzle-orm";
import { z } from "zod";
import { enrichment } from "@/db/schema";
import type { Db } from "@/db";
import {
  computeCost,
  explain,
  runHardFilters,
  scoreListing,
  type Bucket,
  type CostResult,
  type Explanation,
  type HardFilterReport,
  type ListingFacts,
  type ScoreBreakdown,
  type Settings,
  type Weights,
} from "@/lib/domain";
import type { RegionPack } from "@/lib/regions";
import { loadFacts } from "./facts";
import { saveEnrichment } from "./store";

export const ANALYSIS_VERSION = 1;

/** CostResult without its exact fraction (a BigInt, which JSON cannot hold). */
export type StoredCost = Omit<CostResult, "stay"> & {
  stay: Omit<CostResult["stay"], "months"> & { months: string | null };
};

export type Analysis = {
  version: typeof ANALYSIS_VERSION;
  bucket: Bucket;
  cost: StoredCost;
  filters: HardFilterReport;
  /** Null when the listing failed a cheap filter and was not scored. */
  score: ScoreBreakdown | null;
  explanation: Explanation | null;
};

export function storableCost(cost: CostResult): StoredCost {
  const { months, ...stay } = cost.stay;
  return { ...cost, stay: { ...stay, months: months === null ? null : `${months.n}/${months.d}` } };
}

/** Stage 7: cost, full filters and score from the facts as they stand. */
export function analyzeFacts(
  facts: ListingFacts,
  settings: Settings,
  weights: Weights,
  region: RegionPack,
  options: { score?: boolean } = {},
): Analysis {
  const cost = computeCost(facts, settings, region);
  const filters = runHardFilters(facts, settings, cost);
  const scored = options.score !== false;
  const score = scored ? scoreListing(facts, settings, cost, weights) : null;
  return {
    version: ANALYSIS_VERSION,
    bucket: filters.bucket,
    cost: storableCost(cost),
    filters,
    score,
    explanation: score ? explain(score) : null,
  };
}

/** Validate only the parts a reader depends on. The rest passes through unchanged. */
const envelopeSchema = z.looseObject({
  version: z.literal(ANALYSIS_VERSION),
  bucket: z.enum(["pass", "fail", "needs_info", "likely"]),
  cost: z.looseObject({ allInMonthlyCents: z.number().int().nullable(), allInPlusTransitCents: z.number().int().nullable() }),
  filters: z.looseObject({ results: z.array(z.looseObject({ filter: z.string(), status: z.string() })) }),
  score: z.looseObject({ score: z.number() }).nullable(),
});

export function readAnalysis(value: unknown): Analysis | null {
  const parsed = envelopeSchema.safeParse(value);
  return parsed.success ? (value as Analysis) : null;
}

export function enrichmentColumns(analysis: Analysis, scamChecks: unknown) {
  return {
    costBreakdown: analysis,
    allInMonthly: analysis.cost.allInMonthlyCents,
    allInPlusTransit: analysis.cost.allInPlusTransitCents,
    scamChecks,
  };
}

/**
 * Re-run stage 7 for a saved listing from its current facts, without any map call. Step 6 calls
 * this after an answer is recorded, and settings changes use it to recheck every listing.
 */
export async function recompute(
  db: Db,
  listingId: number,
  context: { settings: Settings; weights: Weights; region: RegionPack; now: () => Date },
): Promise<Analysis> {
  const facts = await loadFacts(db, listingId);
  const analysis = analyzeFacts(facts, context.settings, context.weights, context.region);
  const [existing] = await db
    .select({ scamChecks: enrichment.scamChecks })
    .from(enrichment)
    .where(eq(enrichment.listingId, listingId));
  await saveEnrichment(
    db,
    listingId,
    enrichmentColumns(analysis, existing?.scamChecks ?? null),
    context.now().toISOString(),
  );
  return analysis;
}
