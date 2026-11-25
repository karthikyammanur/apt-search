// Reading and writing facts. Field names are the keys of ListingFactValues, the same names the
// domain layer's questions use, so an answer to a question lands in the field that was asked.
//
// Rule 2: every row written here has a provenance. Unknown is the absence of a row: a null is
// never written, and a stored value that no longer parses is treated as Unknown.

import { eq } from "drizzle-orm";
import { z } from "zod";
import { pickCurrentFact } from "@/db/facts";
import { facts as factsTable, type Provenance } from "@/db/schema";
import type { Db } from "@/db";
import {
  SCAM_CHECK_IDS,
  unknownListing,
  type Fact,
  type ListingFactValues,
  type ListingFacts,
} from "@/lib/domain";

const cents = z.number().int().nonnegative();
const flag = z.boolean();
const isoDate = z.iso.date();
const minutes = z.number().int().nonnegative();

const scamStatus = z.enum(["pass", "fail", "resolved"]).nullable();

export const FACT_SCHEMAS = {
  type: z.enum(["room", "studio", "apartment"]),
  city: z.string().min(1),
  rentCents: cents,
  shortTermPremiumCents: cents,
  mandatoryFeesMonthlyCents: cents,
  utilitiesIncluded: flag,
  utilitiesMyShareCents: cents,
  householdSize: z.number().int().positive(),
  internetIncluded: flag,
  internetMonthlyCents: cents,
  rentersInsuranceRequired: flag,
  rentersInsuranceMonthlyCents: cents,
  oneTimeFeesCents: cents,
  nonRefundableDepositCents: cents,
  refundableDepositCents: cents,
  lacksBasics: flag,
  setupItemsCents: cents,
  availableFrom: isoDate,
  leaseType: z.enum(["fixed", "month_to_month", "sublet"]),
  leaseMonths: z.number().int().positive(),
  leaseEnd: isoDate,
  exitClause: z.enum(["break", "sublet", "none"]),
  breakFeeCents: cents,
  privateBedroom: flag,
  privateBath: flag,
  furnished: flag,
  hasBed: flag,
  hasDesk: flag,
  hasChair: flag,
  kitchenEquipped: flag,
  commuteMinutes: minutes,
  commuteRoute: z.object({
    legs: z.array(
      z.object({
        mode: z.enum(["walk", "bike", "transit"]),
        agency: z.string().nullish(),
        from: z.string().nullish(),
        to: z.string().nullish(),
      }),
    ),
  }),
  nearbyStops: z.array(
    z.object({
      name: z.string().optional(),
      walkMinutes: minutes,
      rushHeadwayMinutes: minutes.nullable(),
      regionalRail: z.boolean(),
    }),
  ),
  groceryWalkMinutes: minutes,
  gymWalkMinutes: minutes,
  cafeWalkMinutes: z.array(minutes),
  locationApproximate: flag,
  reviews: z.object({ averageRating: z.number().min(0).max(5), recentCount: z.number().int().nonnegative() }),
  scamChecks: z.object(
    Object.fromEntries(SCAM_CHECK_IDS.map((id) => [id, scamStatus])) as Record<
      (typeof SCAM_CHECK_IDS)[number],
      typeof scamStatus
    >,
  ),
  hasRoommates: flag,
  canMeetRoommates: flag,
} as const satisfies { [K in keyof ListingFactValues]: z.ZodType<unknown> };

export type FactField = keyof typeof FACT_SCHEMAS;

export function isFactField(field: string): field is FactField {
  return Object.hasOwn(FACT_SCHEMAS, field);
}

/** Read the current value of every field of one listing. Unknown fields stay null. */
export async function loadFacts(db: Db, listingId: number): Promise<ListingFacts> {
  const rows = await db.select().from(factsTable).where(eq(factsTable.listingId, listingId));
  const byField = new Map<string, typeof rows>();
  for (const row of rows) byField.set(row.field, [...(byField.get(row.field) ?? []), row]);

  const out = unknownListing();
  const target = out as Record<string, Fact<unknown> | null>;
  for (const [field, fieldRows] of byField) {
    if (!isFactField(field)) continue;
    // Try the best-ranked row first. A stored value that no longer parses falls through to the
    // next source, and finally to Unknown.
    const remaining = [...fieldRows];
    while (remaining.length > 0) {
      const best = pickCurrentFact(remaining);
      if (best === null) break;
      const parsed = FACT_SCHEMAS[field].safeParse(best.value);
      if (parsed.success) {
        target[field] = { value: parsed.data, provenance: best.provenance, sourceUrl: best.sourceUrl, note: best.note };
        break;
      }
      remaining.splice(remaining.indexOf(best), 1);
    }
  }
  return out;
}

export type FactWrite = {
  field: FactField;
  value: unknown;
  provenance: Provenance;
  sourceUrl?: string | null;
  /** Context for the value, such as who routed a commute. */
  note?: string | null;
};

/** Upsert facts. One row per (listing, field, provenance), so a newer reading replaces an older. */
export async function saveFacts(
  db: Db,
  listingId: number,
  writes: FactWrite[],
  checkedAt: string,
): Promise<number> {
  let saved = 0;
  for (const write of writes) {
    if (write.value === null || write.value === undefined) continue;
    const parsed = FACT_SCHEMAS[write.field].safeParse(write.value);
    if (!parsed.success) continue;
    await db
      .insert(factsTable)
      .values({
        listingId,
        field: write.field,
        value: parsed.data,
        provenance: write.provenance,
        sourceUrl: write.sourceUrl ?? null,
        note: write.note ?? null,
        checkedAt,
      })
      .onConflictDoUpdate({
        target: [factsTable.listingId, factsTable.field, factsTable.provenance],
        set: { value: parsed.data, sourceUrl: write.sourceUrl ?? null, note: write.note ?? null, checkedAt },
      });
    saved += 1;
  }
  return saved;
}

/**
 * The facts a set of writes would give once saved, without saving them: what loadFacts returns for a listing
 * that has only these rows. It lets the pipeline judge a post before anything is written.
 */
export function factsFromWrites(writes: readonly FactWrite[]): ListingFacts {
  const out = unknownListing();
  const target = out as Record<string, Fact<unknown> | null>;
  for (const write of writes) {
    if (write.value === null || write.value === undefined) continue;
    const parsed = FACT_SCHEMAS[write.field].safeParse(write.value);
    if (!parsed.success) continue;
    target[write.field] = { value: parsed.data, provenance: write.provenance, sourceUrl: write.sourceUrl ?? null, note: write.note ?? null };
  }
  return out;
}

/** Facts a post states, written with provenance `listing`. */
export function listingFactWrites(
  values: Partial<ListingFactValues>,
  sourceUrl: string | null,
): FactWrite[] {
  return (Object.entries(values) as [FactField, unknown][])
    .filter(([field]) => isFactField(field))
    .map(([field, value]) => ({ field, value, provenance: "listing" as const, sourceUrl }));
}

/** Which fields already have any known row. Used by merge so a duplicate only fills gaps. */
export async function knownFields(db: Db, listingId: number): Promise<Set<string>> {
  const rows = await db.select().from(factsTable).where(eq(factsTable.listingId, listingId));
  return new Set(rows.filter((row) => row.value !== null).map((row) => row.field));
}
