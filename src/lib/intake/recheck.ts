// `npm run recheck`: read every stored post again from its saved text, then redo cost, filters and score.
// It fetches nothing new: no listing source, no map service. The only outside call is the model that reads
// the saved text (the same one intake uses). Each listing is saved in one transaction, so a listing is
// either rechecked whole or left as it was.
//
// What it replaces: the facts the post itself states (provenance `listing`). Facts from other sources (a
// map answer, the landlord, me) stay. A field the channel supplied itself, which the text may not repeat
// (SUPost's price), is kept when the text no longer states it.

import { and, asc, eq } from "drizzle-orm";
import { facts as factsTable, enrichment, listings } from "@/db/schema";
import { tidyText, type Bucket } from "@/lib/domain";
import { recompute } from "./analysis";
import { extractListing } from "./extract";
import { listingFactWrites, loadFacts, saveFacts, type FactField } from "./facts";
import { inTransaction, type IntakeDeps } from "./pipeline";
import type { RawListing } from "./types";
import { validateDraft } from "./validate";

/** Posts that are structured data, not text. There is nothing to read again, so only the numbers are redone. */
const STRUCTURED_SOURCES: ReadonlySet<string> = new Set(["rentcast"]);
/** Fields a channel states in its own record, which the post text may not repeat. */
const CHANNEL_FIELDS: Readonly<Record<string, readonly FactField[]>> = { supost: ["rentCents"] };

export type RecheckRow = {
  id: number;
  source: string;
  title: string | null;
  before: Bucket | null;
  after: Bucket;
  allInMonthlyCents: number | null;
  /** Fields whose stated value changed when the text was read again. */
  changed: string[];
  /** Why it fails, in the words the listing page uses. Empty unless the bucket is fail. */
  failReasons: string[];
  /** What is still Unknown, as the questions it raises and the cost lines nobody has stated. */
  unknowns: string[];
  note: string | null;
};

export async function recheckListings(deps: IntakeDeps): Promise<RecheckRow[]> {
  const rows = await deps.db.select().from(listings).orderBy(asc(listings.id));
  const report: RecheckRow[] = [];
  for (const row of rows) {
    const [before] = await deps.db.select({ bucket: enrichment.bucket }).from(enrichment).where(eq(enrichment.listingId, row.id));
    let note: string | null = null;
    let draft: Awaited<ReturnType<typeof extractListing>> | null = null;
    if (STRUCTURED_SOURCES.has(row.source)) note = "structured data, numbers redone only";
    else if (!row.rawText?.trim()) note = "no saved text, numbers redone only";
    else {
      const raw: RawListing = {
        channel: "paste",
        source: row.source,
        url: row.url,
        title: row.title ?? undefined,
        text: row.rawText ?? "",
        photoUrls: [],
        photoHashes: [],
      };
      draft = await extractListing(raw, { llm: deps.llm, now: deps.now });
    }

    const changed: string[] = [];
    const analysis = await inTransaction(deps, async (tx) => {
      if (draft) {
        if (!draft.ok) note = `could not read the text again (${draft.error}), numbers redone only`;
        else {
          const validated = validateDraft(draft.draft, deps.settings);
          if (!validated.ok) note = `the text no longer passes validation (${validated.reason}), numbers redone only`;
          else if (validated.draft.postType !== "room_offered" && validated.draft.postType !== "whole_place_offered") {
            note = `read again as "${validated.draft.postType}", left as it was`;
          } else {
            const fresh = validated.draft;
            const old = await loadFacts(tx.db, row.id);
            const keep = (CHANNEL_FIELDS[row.source] ?? []).filter((field) => fresh.facts[field] === undefined && old[field]?.provenance === "listing");
            const rows = await tx.db.select().from(factsTable).where(and(eq(factsTable.listingId, row.id), eq(factsTable.provenance, "listing")));
            for (const stored of rows) {
              if (keep.includes(stored.field as FactField)) continue;
              await tx.db.delete(factsTable).where(eq(factsTable.id, stored.id));
            }
            await saveFacts(tx.db, row.id, listingFactWrites(fresh.facts, row.url), deps.now().toISOString());
            const after = await loadFacts(tx.db, row.id);
            for (const field of new Set([...Object.keys(old), ...Object.keys(after)]) as Set<FactField>) {
              if (JSON.stringify(old[field]?.value ?? null) !== JSON.stringify(after[field]?.value ?? null)) changed.push(field);
            }
            await tx.db
              .update(listings)
              .set({
                type: fresh.facts.type ?? row.type,
                city: fresh.facts.city ?? row.city,
                address: row.address ?? fresh.address,
              })
              .where(eq(listings.id, row.id));
          }
        }
      }
      return recompute(tx.db, row.id, tx);
    });

    // The scam checks are many small fields; they are one line here.
    const unknowns = [
      ...new Set([
        ...analysis.filters.results.flatMap((r) => (r.status === "unknown" ? r.questions.map((q) => (q.field.startsWith("scam.") ? "scam checks" : q.field)) : [])),
        ...analysis.cost.lines.filter((l) => l.status === "unknown" && l.kind === "recurring").map((l) => `cost: ${l.label}`),
      ]),
    ];
    report.push({
      id: row.id,
      source: row.source,
      title: row.title,
      before: before?.bucket ?? null,
      after: analysis.bucket,
      allInMonthlyCents: analysis.cost.allInMonthlyCents,
      changed,
      failReasons: analysis.filters.results.filter((r) => r.status === "fail").map((r) => tidyText(r.reason)),
      unknowns,
      note,
    });
  }
  return report;
}
