// Small helpers shared by the query modules. Reads only.

import { inArray } from "drizzle-orm";
import { pickCurrentFact } from "@/db/facts";
import { facts as factsTable, type Provenance } from "@/db/schema";
import type { Db } from "@/db";
import { getDb } from "@/db";
import { isFactField } from "@/lib/intake/facts";

export type QueryOptions = { db?: Db; now?: () => Date };

export function dbOf(options: QueryOptions | undefined): Db {
  return options?.db ?? getDb();
}

export type FactRow = {
  field: string;
  value: unknown;
  provenance: Provenance;
  sourceUrl: string | null;
  note: string | null;
  checkedAt: string;
};

/** Every fact row of these listings, grouped by listing then field. */
export async function factRowsFor(db: Db, listingIds: number[]): Promise<Map<number, Map<string, FactRow[]>>> {
  const out = new Map<number, Map<string, FactRow[]>>();
  if (listingIds.length === 0) return out;
  const rows = await db.select().from(factsTable).where(inArray(factsTable.listingId, listingIds));
  for (const row of rows) {
    if (!isFactField(row.field)) continue;
    const byField = out.get(row.listingId) ?? new Map<string, FactRow[]>();
    const list = byField.get(row.field) ?? [];
    list.push({
      field: row.field,
      value: row.value,
      provenance: row.provenance,
      sourceUrl: row.sourceUrl,
      note: row.note,
      checkedAt: row.checkedAt,
    });
    byField.set(row.field, list);
    out.set(row.listingId, byField);
  }
  return out;
}

/** The current value of one field (see pickCurrentFact), or null when Unknown. */
export function currentValue<T>(byField: Map<string, FactRow[]> | undefined, field: string): T | null {
  const picked = pickCurrentFact(byField?.get(field) ?? []);
  return picked === null ? null : (picked.value as T);
}
