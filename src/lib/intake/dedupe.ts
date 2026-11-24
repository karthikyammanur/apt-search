// Stage: dedupe. The same place posted on several sites becomes one listing with every source
// linked. Pure matching over rows loaded from the database, so each rule is tested on its own.
//
// A candidate is a duplicate of a saved listing when, in this order:
//   1. its link is already known (the listing's url or any source link);
//   2. one of its photo hashes matches a saved photo and the addresses do not contradict;
//   3. its normalized street address matches and the rents are within 5 percent.
//
// A photo match whose address clearly differs is not a merge. It is a reused photo, which is a
// scam signal: the match is returned as `photoReuse` and the trust stage fails that check.

import { pickCurrentFact } from "@/db/facts";
import { facts, listings, photos } from "@/db/schema";
import type { Db } from "@/db";

export const RENT_TOLERANCE = 0.05;

export type KnownListing = {
  id: number;
  type: string | null;
  city: string | null;
  address: string | null;
  rentCents: number | null;
  /** The listing's own url plus every source link url. */
  urls: string[];
  photoHashes: string[];
};

export type Candidate = {
  url: string | null;
  address: string | null;
  city: string | null;
  rentCents: number | null;
  photoHashes: string[];
};

export type DedupeMatch =
  | { kind: "url" | "photo" | "address_rent"; id: number }
  | { kind: "photo_reuse"; id: number };

const SUFFIXES: Record<string, string> = {
  street: "st", avenue: "ave", road: "rd", boulevard: "blvd", drive: "dr", lane: "ln",
  court: "ct", place: "pl", terrace: "ter", circle: "cir", highway: "hwy", parkway: "pkwy",
  north: "n", south: "s", east: "e", west: "w",
  apartment: "unit", apt: "unit", suite: "unit", ste: "unit", unit: "unit",
};

/**
 * The street line of an address, lowercased, with abbreviations unified and punctuation gone.
 * "123 University Avenue, Apt 4, Palo Alto" and "123 University Ave #4" both give
 * "123 university ave unit 4". Null without a street number, since "El Camino near Page Mill"
 * names no single place.
 */
export function normalizeAddress(address: string | null): string | null {
  if (!address) return null;
  // Everything up to the city: the first one or two comma parts, so a unit part is kept.
  const parts = address.split(",").map((part) => part.trim());
  const street = [parts[0] ?? "", /^(?:apt|unit|suite|ste|#)/i.test(parts[1] ?? "") ? (parts[1] ?? "") : ""]
    .join(" ")
    .toLowerCase()
    .replace(/#\s*/g, "unit ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ");
  const tokens = street
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => SUFFIXES[token] ?? token);
  const joined = tokens.join(" ");
  return /^\d/.test(joined) ? joined : null;
}

export function rentsMatch(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= RENT_TOLERANCE * Math.max(a, b);
}

function sameCity(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function findDuplicate(known: KnownListing[], candidate: Candidate): DedupeMatch | null {
  if (candidate.url) {
    const byUrl = known.find((k) => k.urls.includes(candidate.url as string));
    if (byUrl) return { kind: "url", id: byUrl.id };
  }
  const key = normalizeAddress(candidate.address);
  const addressOf = (k: KnownListing) => normalizeAddress(k.address);

  if (candidate.photoHashes.length > 0) {
    const byPhoto = known.find((k) => k.photoHashes.some((h) => candidate.photoHashes.includes(h)));
    if (byPhoto) {
      const other = addressOf(byPhoto);
      if (key !== null && other !== null && key !== other) return { kind: "photo_reuse", id: byPhoto.id };
      return { kind: "photo", id: byPhoto.id };
    }
  }
  if (key !== null) {
    const byAddress = known.find(
      (k) => addressOf(k) === key && sameCity(k.city, candidate.city) && rentsMatch(k.rentCents, candidate.rentCents),
    );
    if (byAddress) return { kind: "address_rent", id: byAddress.id };
  }
  return null;
}

/** Everything the matching rules need, in memory. A single-user database stays small. */
export async function loadKnownListings(db: Db): Promise<KnownListing[]> {
  const [listingRows, factRows, photoRows] = await Promise.all([
    db.select().from(listings),
    db.select().from(facts),
    db.select({ listingId: photos.listingId, phash: photos.phash }).from(photos),
  ]);
  return listingRows.map((row) => {
    const own = factRows.filter((f) => f.listingId === row.id);
    const rent = pickCurrentFact(own.filter((f) => f.field === "rentCents"));
    const type = pickCurrentFact(own.filter((f) => f.field === "type"));
    return {
      id: row.id,
      type: row.type ?? (typeof type?.value === "string" ? type.value : null),
      city: row.city,
      address: row.address,
      rentCents: typeof rent?.value === "number" ? rent.value : null,
      urls: [...(row.url ? [row.url] : []), ...row.sourceLinks.map((link) => link.url)],
      photoHashes: photoRows.filter((p) => p.listingId === row.id && p.phash).map((p) => p.phash as string),
    };
  });
}
