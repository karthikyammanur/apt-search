// SUPost channel: poll housing listings through the SUPost provider (a documented public API).
// The list API gives a title, a price, a date and a link, and no listing body. The body and photo
// links come from SUPost's agent server, one call per post that is new. No listing page is ever opened. SUPost covers the Stanford area, so it is skipped for any other region.

import type { Settings } from "@/lib/domain";
import type { createSupost } from "@/lib/providers";
import type { RawListing } from "../types";
import type { Collected } from "./types";

type SupostClient = Pick<ReturnType<typeof createSupost>, "listings"> & Partial<Pick<ReturnType<typeof createSupost>, "detail">>;
type SupostItem = {
  id: number;
  title: string | null;
  price: number | null;
  created_at: string | null;
  url: string;
  stanford_verified: boolean;
};

const KINDS = ["rooms", "shares", "sublets"] as const;

export function supostToRaw(item: SupostItem, client?: SupostClient): RawListing | null {
  const title = item.title?.trim();
  if (!title) return null;
  const lines = [
    title,
    ...(item.price !== null ? [`Price: $${item.price}`] : []),
    ...(item.created_at ? [`Posted: ${item.created_at}`] : []),
  ];
  return {
    channel: "supost",
    source: "supost",
    url: item.url,
    title,
    text: lines.join("\n"),
    photoUrls: [],
    photoHashes: [],
    // The price is a field of the API record, so it counts as stated by the listing.
    prefill: item.price !== null && item.price > 0 ? { facts: { rentCents: Math.round(item.price * 100) } } : undefined,
    meta: { stanfordVerified: item.stanford_verified ? 1 : 0, supostId: item.id },
    detail: client?.detail
      ? async () => {
          const found = await client.detail!(item.id);
          return found.ok ? found.data : null;
        }
      : undefined,
  };
}

export async function collectSupost(client: SupostClient, settings: Pick<Settings, "region">): Promise<Collected> {
  if (settings.region !== "bay-area") return { items: [], error: null, skipped: "SUPost only covers the Stanford area" };
  const byUrl = new Map<string, RawListing>();
  const errors: string[] = [];
  for (const kind of KINDS) {
    const result = await client.listings(kind);
    if (!result.ok) {
      errors.push(`${kind}: ${result.error}`);
      continue;
    }
    for (const item of result.data.listings) {
      const raw = supostToRaw(item, client);
      if (raw?.url && !byUrl.has(raw.url)) byUrl.set(raw.url, raw);
    }
  }
  const items = [...byUrl.values()];
  // The channel failed only if every search did. A partial failure is reported but not fatal.
  return { items, error: errors.length === KINDS.length ? errors.join("; ") : null, warnings: errors };
}
