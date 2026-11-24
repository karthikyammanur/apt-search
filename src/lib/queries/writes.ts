// The small writes both later steps need: my status on a listing, and a fact I or a landlord
// gave. Recording a fact re-runs cost, filters and score for that listing (no map calls) and
// reports what changed. Nothing here sends anything anywhere.

import { eq } from "drizzle-orm";
import { enrichment, facts as factsTable, listings, USER_STATUSES } from "@/db/schema";
import type { Bucket } from "@/lib/domain";
import { recompute } from "@/lib/intake/analysis";
import { FACT_SCHEMAS, isFactField, type FactField } from "@/lib/intake/facts";
import type { UserStatus } from "./board";
import type { WriteResult } from "./leads";
import { analysisContext } from "./settings";
import { dbOf, type QueryOptions } from "./shared";

/** Shortlist or reject a listing (or clear it back to none), with my reason. */
export async function setUserStatus(
  input: { listingId: number; status: UserStatus; reason?: string | null },
  options?: QueryOptions,
): Promise<WriteResult<{ listingId: number; status: UserStatus; reason: string | null }>> {
  if (!(USER_STATUSES as readonly string[]).includes(input.status)) return { ok: false, error: "unknown status" };
  const db = dbOf(options);
  const reason = input.status === "none" ? null : input.reason?.trim() || null;
  const [row] = await db
    .update(listings)
    .set({ userStatus: input.status, userStatusReason: reason })
    .where(eq(listings.id, input.listingId))
    .returning({ id: listings.id });
  return row ? { ok: true, data: { listingId: row.id, status: input.status, reason } } : { ok: false, error: "no such listing" };
}

export type AnalysisSnapshot = {
  bucket: Bucket | null;
  score: number | null;
  /** Integer cents. */
  allInMonthlyCents: number | null;
  allInPlusTransitCents: number | null;
};

export type RecordFactResult = {
  listingId: number;
  field: FactField;
  before: AnalysisSnapshot;
  after: AnalysisSnapshot;
  /** Which snapshot keys changed. */
  changed: (keyof AnalysisSnapshot)[];
};

async function snapshot(db: ReturnType<typeof dbOf>, listingId: number): Promise<AnalysisSnapshot> {
  const [row] = await db.select().from(enrichment).where(eq(enrichment.listingId, listingId));
  return {
    bucket: row?.bucket ?? null,
    score: row?.score ?? null,
    allInMonthlyCents: row?.allInMonthly ?? null,
    allInPlusTransitCents: row?.allInPlusTransit ?? null,
  };
}

/**
 * Save a fact I learned (provenance `me`) or a landlord told me (`landlord`). The value is
 * checked against that field's schema: money is integer cents, dates are YYYY-MM-DD. A landlord
 * row never erases what the listing said; both are kept and the landlord's wins.
 */
export async function recordFact(
  input: {
    listingId: number;
    field: string;
    value: unknown;
    provenance: "me" | "landlord";
    note?: string | null;
    sourceUrl?: string | null;
  },
  options?: QueryOptions,
): Promise<WriteResult<RecordFactResult>> {
  if (input.provenance !== "me" && input.provenance !== "landlord") return { ok: false, error: "provenance must be me or landlord" };
  if (!isFactField(input.field)) return { ok: false, error: `unknown field ${input.field}` };
  const parsed = FACT_SCHEMAS[input.field].safeParse(input.value);
  if (!parsed.success || parsed.data === null || parsed.data === undefined) {
    return { ok: false, error: `invalid value for ${input.field}` };
  }
  const db = dbOf(options);
  const [listing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, input.listingId));
  if (!listing) return { ok: false, error: "no such listing" };

  const now = (options?.now ?? (() => new Date()))().toISOString();
  const before = await snapshot(db, input.listingId);
  const note = input.note?.trim() || null;
  await db
    .insert(factsTable)
    .values({
      listingId: input.listingId,
      field: input.field,
      value: parsed.data,
      provenance: input.provenance,
      sourceUrl: input.sourceUrl ?? null,
      note,
      checkedAt: now,
    })
    .onConflictDoUpdate({
      target: [factsTable.listingId, factsTable.field, factsTable.provenance],
      set: { value: parsed.data, sourceUrl: input.sourceUrl ?? null, note, checkedAt: now },
    });
  await recompute(db, input.listingId, await analysisContext(options));
  await db.update(listings).set({ lastChecked: now }).where(eq(listings.id, input.listingId));
  const after = await snapshot(db, input.listingId);
  const changed = (Object.keys(before) as (keyof AnalysisSnapshot)[]).filter((key) => before[key] !== after[key]);
  return { ok: true, data: { listingId: input.listingId, field: input.field, before, after, changed } };
}
