import { z } from "zod";
import { cachedFetch, failure, query, TTL, type ClientOptions } from "./core";

export const supostSchema = z.object({
  listings: z.array(
    z.object({
      id: z.number().int(),
      title: z.string().nullable(),
      price: z.number().nullable(),
      category: z.string().nullable(),
      created_at: z.string().nullable(),
      url: z.url(),
      poster_email_domain: z.string().nullable(),
      stanford_verified: z.boolean(),
    }),
  ),
  next_cursor: z.string().nullable(),
});
/** The public API has category and full-text filters, but no subcategory parameter. */
export function createSupost(options: Pick<ClientOptions, "transport"> = {}) {
  return {
    listings(kind: "rooms" | "shares" | "sublets" = "rooms", cursor?: string) {
      if (
        !z.enum(["rooms", "shares", "sublets"]).safeParse(kind).success ||
        (cursor !== undefined && !z.string().min(1).max(2000).safeParse(cursor).success)
      )
        return Promise.resolve(failure("bad_response"));
      const q = { rooms: "room", shares: "share", sublets: "sublet" }[kind];
      return (options.transport ?? cachedFetch)(
        "supost",
        {
          url: query("https://supost.com/api/public/listings", {
            cat: "housing",
            q,
            limit: 50,
            ...(cursor ? { cursor } : {}),
          }),
          schema: supostSchema,
        },
        TTL.listings,
      );
    },
  };
}
export const supost = createSupost();
