// Pure helper for reading facts. A listing can hold several rows for one field, one per source
// of truth (see the unique index in schema.ts). This picks the one to show and use.

import type { Provenance } from "./schema";

/** Highest priority first. A landlord's answer beats what the listing said. */
export const PROVENANCE_PRIORITY = [
  "landlord",
  "me",
  "listing",
  "api",
  "estimate",
] as const satisfies readonly Provenance[];

type FactLike = {
  value: unknown;
  provenance: Provenance;
  checkedAt: string;
};

/**
 * Pick the current row for one field from all of that field's rows.
 *
 * Rows with a null value are skipped: null means unknown, so it never overrides a known value
 * from a lower-priority source. Returns null when no row has a known value. If two rows share a
 * provenance, the most recently checked one wins.
 */
export function pickCurrentFact<T extends FactLike>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.value === null || row.value === undefined) continue;
    if (best === null || isBetter(row, best)) best = row;
  }
  return best;
}

function isBetter(candidate: FactLike, current: FactLike): boolean {
  const byPriority =
    PROVENANCE_PRIORITY.indexOf(candidate.provenance) -
    PROVENANCE_PRIORITY.indexOf(current.provenance);
  if (byPriority !== 0) return byPriority < 0;
  return candidate.checkedAt > current.checkedAt;
}
