// Region lookup. A region without a pack gets one that answers Unknown for everything, so
// transit pass and utility costs show as Unknown until that region's pack is added.

import { bayAreaPack } from "./bay-area";
import type { RegionPack } from "./types";

export type * from "./types";
export { bayAreaPack, caltrainZone } from "./bay-area";

const PACKS: Readonly<Record<string, RegionPack>> = { [bayAreaPack.id]: bayAreaPack };

export function unknownRegionPack(id: string): RegionPack {
  const reason = `No region pack for "${id}" yet`;
  return {
    id,
    name: id,
    hasData: false,
    utilitiesMonthly: () => ({ status: "unknown", reason }),
    internetMonthly: () => ({ status: "unknown", reason }),
    rentersInsuranceMonthly: () => ({ status: "unknown", reason }),
    cheapestPass: () => ({ status: "unknown", reason }),
  };
}

/**
 * Other names for a pack: the cities and areas it covers. The setting can hold a pack id
 * ("bay-area") or the name of the place the user searches in ("Palo Alto", "EVGR").
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  [bayAreaPack.id]: [
    "bay area",
    "san francisco bay area",
    "sf bay area",
    "sf bay",
    "peninsula",
    "south bay",
    "silicon valley",
    "palo alto",
    "east palo alto",
    "stanford",
    "stanford university",
    "evgr",
    "escondido village",
    "menlo park",
    "atherton",
    "redwood city",
    "san carlos",
    "belmont",
    "san mateo",
    "burlingame",
    "millbrae",
    "san bruno",
    "south san francisco",
    "portola valley",
    "woodside",
    "los altos",
    "los altos hills",
    "mountain view",
    "sunnyvale",
    "santa clara",
    "cupertino",
    "milpitas",
    "campbell",
    "los gatos",
    "san jose",
  ],
};

/** Lower case, no punctuation, one space between words: "Palo-Alto, CA" and "palo alto" match. */
export function normalizeRegionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/ (ca|california|usa)$/, "")
    .trim();
}

const BY_NAME: ReadonlyMap<string, RegionPack> = new Map(
  Object.values(PACKS).flatMap((pack) =>
    [pack.id, pack.name, ...(ALIASES[pack.id] ?? [])].map((name) => [normalizeRegionName(name), pack] as const),
  ),
);

export function getRegionPack(id: string): RegionPack {
  return PACKS[id] ?? BY_NAME.get(normalizeRegionName(id)) ?? unknownRegionPack(id);
}
