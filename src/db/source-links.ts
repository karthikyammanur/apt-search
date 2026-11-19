// Shape of listings.source_links: every place a listing was seen, once duplicates are merged.

import { z } from "zod";

export const sourceLinkSchema = z.object({
  source: z.string().min(1),
  url: z.string().min(1),
  /** ISO 8601 timestamp of when this source showed the listing. */
  seen_at: z.iso.datetime(),
});

export const sourceLinksSchema = z.array(sourceLinkSchema);

export type SourceLink = z.infer<typeof sourceLinkSchema>;
