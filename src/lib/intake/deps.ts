// Build the pipeline's dependencies. Everything has a live default and can be replaced in tests.

import { getDb } from "@/db";
import { getSettings } from "@/db/settings";
import { llm as liveLlm } from "@/lib/llm";
import { getRegionPack } from "@/lib/regions";
import { liveGeo } from "./geo";
import type { IntakeDeps } from "./pipeline";
import { loadWeights } from "./store";

export async function createDeps(overrides: Partial<Omit<IntakeDeps, "memo">> = {}): Promise<IntakeDeps> {
  const db = overrides.db ?? getDb();
  const settings = overrides.settings ?? (await getSettings(db));
  return {
    db,
    settings,
    weights: overrides.weights ?? (await loadWeights(db)),
    region: overrides.region ?? getRegionPack(settings.region),
    llm: overrides.llm ?? liveLlm,
    geo: overrides.geo ?? liveGeo,
    now: overrides.now ?? (() => new Date()),
    memo: {},
  };
}
