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

export function getRegionPack(id: string): RegionPack {
  return PACKS[id] ?? unknownRegionPack(id);
}
