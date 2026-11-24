// The intake pipeline. Every listing, from every channel, goes through the same fixed stages:
//
//   1. extract (the only model call), then validate
//   2. roommate-wanted posts become roommate_leads and stop
//   3. dedupe against saved listings; a duplicate merges its source into source_links
//   4. store listing, facts (provenance listing) and photos, plus the trust checks
//   5. cheap hard filters; a clear Fail stops here, so no map quota is spent on it
//   6. enrich survivors: geocode, commute, bike, stops, grocery, gym, cafes
//   7. cost, full filters and score from the domain functions, stored in `enrichment`
//
// Each stage is its own exported function so each is tested on its own. `processRaw` runs them
// in order and never throws: a failure becomes an outcome with a note.

import type { Db } from "@/db";
import type { Settings, Weights } from "@/lib/domain";
import {
  checkBudget,
  checkFurnished,
  checkLease,
  checkMoveIn,
  checkPrivateBedBath,
  checkRoommates,
  checkScamChecks,
  computeCost,
  type FilterResult,
  type ListingFacts,
} from "@/lib/domain";
import type { Llm } from "@/lib/llm";
import type { RegionPack } from "@/lib/regions";
import { analyzeFacts, enrichmentColumns, recompute, type Analysis } from "./analysis";
import { findDuplicate, loadKnownListings, type DedupeMatch, type KnownListing } from "./dedupe";
import { enrichListing, isGeocodable, cityFromFormatted, loadStops, type StopRow } from "./enrich";
import { extractListing } from "./extract";
import { knownFields, listingFactWrites, loadFacts, saveFacts, type FactWrite } from "./facts";
import type { Geo } from "./geo";
import {
  insertListing,
  mergeSource,
  roommateLeadExists,
  saveEnrichment,
  saveRoommateLead,
  setLocation,
  touchListing,
} from "./store";
import { runTrustChecks, type TrustResult } from "./trust";
import type { Draft, IntakeOutcome, RawListing } from "./types";
import { validateDraft } from "./validate";

export type IntakeDeps = {
  db: Db;
  settings: Settings;
  weights: Weights;
  region: RegionPack;
  llm: Pick<Llm, "generateStructured">;
  geo: Geo;
  now: () => Date;
  /** Filled lazily, once per run. */
  memo: {
    stops?: Promise<StopRow[]>;
    office?: Promise<{ lat: number; lng: number } | null>;
  };
};

export function getStops(deps: IntakeDeps): Promise<StopRow[]> {
  deps.memo.stops ??= loadStops(deps.db);
  return deps.memo.stops;
}

export function getOffice(deps: IntakeDeps): Promise<{ lat: number; lng: number } | null> {
  deps.memo.office ??= deps.geo.geocode(deps.settings.officeAddress).then((r) => (r.ok ? { lat: r.data.lat, lng: r.data.lng } : null));
  return deps.memo.office;
}

// Stage 1: extract and validate.

export type StageOneResult =
  | { ok: true; draft: Draft }
  | { ok: false; kind: "extraction_failed" | "rejected"; note: string };

export async function stageExtract(deps: IntakeDeps, raw: RawListing): Promise<StageOneResult> {
  const extracted = await extractListing(raw, { llm: deps.llm });
  if (!extracted.ok) return { ok: false, kind: "extraction_failed", note: extracted.error };
  const validated = validateDraft(extracted.draft, deps.settings);
  if (!validated.ok) return { ok: false, kind: "rejected", note: validated.reason };
  return { ok: true, draft: validated.draft };
}

// Stage 2: roommate-wanted posts.

export async function stageRoommate(deps: IntakeDeps, raw: RawListing, draft: Draft) {
  return saveRoommateLead(deps.db, raw, draft, deps.now().toISOString());
}

// Stage 3: dedupe.

export function stageDedupe(known: KnownListing[], raw: RawListing, draft: Draft): DedupeMatch | null {
  return findDuplicate(known, {
    url: raw.url,
    address: draft.address,
    city: draft.facts.city ?? null,
    rentCents: draft.facts.rentCents ?? null,
    photoHashes: raw.photoHashes,
  });
}

/** A duplicate adds its source and photos, and fills fields the saved listing does not know yet. */
export async function stageMerge(
  deps: IntakeDeps,
  match: DedupeMatch,
  raw: RawListing,
  draft: Draft,
): Promise<{ factsAdded: number }> {
  const now = deps.now().toISOString();
  await mergeSource(deps.db, match.id, raw, now);
  const have = await knownFields(deps.db, match.id);
  const fresh = listingFactWrites(draft.facts, raw.url).filter((w) => !have.has(w.field));
  const factsAdded = await saveFacts(deps.db, match.id, fresh, now);
  return { factsAdded };
}

// Stage 4: store.

export function stageTrust(known: KnownListing[], raw: RawListing, draft: Draft, match: DedupeMatch | null): TrustResult {
  return runTrustChecks({
    text: raw.text,
    type: draft.facts.type ?? null,
    rentCents: draft.facts.rentCents ?? null,
    photoReusedFrom: match?.kind === "photo_reuse" ? match.id : null,
    saved: known.map((k) => ({ id: k.id, type: k.type, rentCents: k.rentCents })),
  });
}

export async function stageStore(
  deps: IntakeDeps,
  raw: RawListing,
  draft: Draft,
  trust: TrustResult,
): Promise<number> {
  const now = deps.now().toISOString();
  const id = await insertListing(deps.db, raw, draft, now);
  const writes: FactWrite[] = [
    ...listingFactWrites(draft.facts, raw.url),
    { field: "scamChecks", value: trust.checks, provenance: "estimate" },
  ];
  await saveFacts(deps.db, id, writes, now);
  return id;
}

// Stage 5: cheap hard filters. No map data is needed for these.

export function cheapFilters(facts: ListingFacts, settings: Settings, region: RegionPack): FilterResult[] {
  const cost = computeCost(facts, settings, region);
  return [
    checkBudget(cost, settings),
    checkMoveIn(facts, settings),
    checkLease(facts, settings),
    checkPrivateBedBath(facts, settings),
    checkFurnished(facts, settings),
    checkScamChecks(facts),
    checkRoommates(facts),
  ].filter((result) => result.status === "fail");
}

// Stage 6: enrich.

export type EnrichStageResult = { enriched: boolean; notes: string[]; columns: Record<string, unknown> };

export async function stageEnrich(
  deps: IntakeDeps,
  listingId: number,
  place: { address: string | null; lat: number | null; lng: number | null },
): Promise<EnrichStageResult> {
  const now = deps.now().toISOString();
  let { lat, lng } = place;
  const notes: string[] = [];
  if (lat === null || lng === null) {
    if (!isGeocodable(place.address)) {
      return { enriched: false, notes: ["no street address, so no commute"], columns: {} };
    }
    const found = await deps.geo.geocode(place.address);
    if (!found.ok) return { enriched: false, notes: [`geocode: ${found.error}`], columns: {} };
    lat = found.data.lat;
    lng = found.data.lng;
    const city = cityFromFormatted(found.data.address);
    await setLocation(deps.db, listingId, { lat, lng, city });
    const have = await knownFields(deps.db, listingId);
    if (city && !have.has("city")) {
      await saveFacts(deps.db, listingId, [{ field: "city", value: city, provenance: "api" }], now);
    }
  } else {
    await setLocation(deps.db, listingId, { lat, lng });
  }
  const office = await getOffice(deps);
  if (!office) return { enriched: false, notes: ["office address could not be geocoded"], columns: {} };

  const result = await enrichListing(deps.geo, {
    lat,
    lng,
    office,
    startDate: deps.settings.startDate,
    stops: await getStops(deps),
  });
  await saveFacts(deps.db, listingId, result.facts, now);
  notes.push(...result.notes);
  return { enriched: true, notes, columns: result.columns };
}

// Stage 7: cost, full filters, score, and store.

export async function stageAnalyze(
  deps: IntakeDeps,
  listingId: number,
  trust: TrustResult | null,
  columns: Record<string, unknown>,
  options: { score: boolean },
): Promise<{ analysis: Analysis; facts: ListingFacts }> {
  const facts = await loadFacts(deps.db, listingId);
  const analysis = analyzeFacts(facts, deps.settings, deps.weights, deps.region, { score: options.score });
  await saveEnrichment(
    deps.db,
    listingId,
    { ...columns, ...enrichmentColumns(analysis, trust ? { checks: trust.checks, details: trust.details, medianCents: trust.medianCents } : null) },
    deps.now().toISOString(),
  );
  return { analysis, facts };
}

// The whole pipeline.

const outcome = (raw: RawListing, over: Partial<IntakeOutcome> & Pick<IntakeOutcome, "status">): IntakeOutcome => ({
  source: raw.source,
  url: raw.url,
  listingId: null,
  type: null,
  bucket: null,
  allInMonthlyCents: null,
  commuteMinutes: null,
  score: null,
  note: null,
  ...over,
});

function summarize(raw: RawListing, listingId: number, analysis: Analysis, facts: ListingFacts, status: IntakeOutcome["status"], note: string | null): IntakeOutcome {
  return outcome(raw, {
    status,
    listingId,
    type: facts.type?.value ?? null,
    bucket: analysis.bucket,
    allInMonthlyCents: analysis.cost.allInMonthlyCents,
    commuteMinutes: facts.commuteMinutes?.value ?? null,
    score: analysis.score ? Math.round(analysis.score.score * 10) / 10 : null,
    note,
  });
}

export async function processRaw(deps: IntakeDeps, raw: RawListing): Promise<IntakeOutcome> {
  try {
    const now = deps.now().toISOString();
    const known = await loadKnownListings(deps.db);

    // A link already saved needs no model call: it only refreshes "last checked".
    if (raw.url) {
      const seen = known.find((k) => k.urls.includes(raw.url as string));
      if (seen) {
        await touchListing(deps.db, seen.id, now);
        return outcome(raw, { status: "already_seen", listingId: seen.id });
      }
      if (await roommateLeadExists(deps.db, raw.url)) return outcome(raw, { status: "already_seen", note: "roommate lead" });
    }

    const one = await stageExtract(deps, raw);
    if (!one.ok) {
      return outcome(raw, { status: one.kind === "rejected" ? "skipped" : "error", note: one.note });
    }
    const draft = one.draft;

    if (draft.postType === "roommate_wanted") {
      const lead = await stageRoommate(deps, raw, draft);
      return outcome(raw, { status: lead.created ? "roommate_lead" : "already_seen", note: "roommate wanted" });
    }
    if (draft.postType === "unknown") {
      return outcome(raw, { status: "skipped", note: "not a housing offer" });
    }

    const match = stageDedupe(known, raw, draft);
    if (match && match.kind !== "photo_reuse") {
      const merged = await stageMerge(deps, match, raw, draft);
      if (merged.factsAdded > 0) {
        const analysis = await recompute(deps.db, match.id, deps);
        const facts = await loadFacts(deps.db, match.id);
        return summarize(raw, match.id, analysis, facts, "merged", `merged by ${match.kind}`);
      }
      return outcome(raw, { status: "merged", listingId: match.id, note: `merged by ${match.kind}` });
    }

    const trust = stageTrust(known, raw, draft, match);
    const listingId = await stageStore(deps, raw, draft, trust);

    const early = cheapFilters(await loadFacts(deps.db, listingId), deps.settings, deps.region);
    if (early.length > 0) {
      const { analysis, facts } = await stageAnalyze(deps, listingId, trust, {}, { score: false });
      return summarize(raw, listingId, analysis, facts, "stored", `failed early: ${early[0]?.reason ?? ""}`);
    }

    const enriched = await stageEnrich(deps, listingId, { address: draft.address, lat: draft.lat, lng: draft.lng });
    const { analysis, facts } = await stageAnalyze(deps, listingId, trust, enriched.columns, { score: true });
    return summarize(raw, listingId, analysis, facts, "stored", enriched.notes[0] ?? null);
  } catch (error) {
    // Never throw across the pipeline boundary. Only the error name goes out, not its text,
    // which could echo listing content.
    return outcome(raw, { status: "error", note: error instanceof Error ? error.name : "error" });
  }
}

/** Paste fallback for the chat (step 6): free text and optional screenshots. */
export async function intakeFromText(
  deps: IntakeDeps,
  text: string,
  images?: RawListing["images"],
): Promise<IntakeOutcome> {
  return processRaw(deps, {
    channel: "paste",
    source: "paste",
    url: null,
    text,
    photoUrls: [],
    photoHashes: [],
    images,
  });
}
