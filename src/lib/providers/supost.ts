import { z } from "zod";
import { cachedFetch, failure, mapped, query, TTL, type ClientOptions } from "./core";

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
/** SUPost's agent server (MCP over HTTP, no sign-in) answers with a server-sent event. */
const SUPOST_MCP_URL = "https://mcp.supost.com/mcp";

/** The JSON-RPC message inside the first "data:" line of the event stream. */
function firstEventData(text: string): unknown {
  const line = text.split(/\r?\n/).find((l) => l.startsWith("data:"));
  if (!line) throw new Error("no data line");
  return JSON.parse(line.slice(5).trim());
}

export const supostToolSchema = z.object({
  result: z.object({
    isError: z.boolean().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string() })).min(1),
  }),
});
const supostDetailBody = z.object({
  description: z.string().nullable().optional(),
  photos: z.array(z.string()).optional(),
});
export type SupostDetail = { description: string; photoUrls: string[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
/** The description arrives HTML escaped ("Pub &amp; Brewery"). Plain text only goes onward. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name] ?? whole)
    .replace(/[ \t]+/g, " ")
    .trim();
}

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
    /**
     * One listing's description and photo links, from SUPost's own agent server. The listings API
     * returns only a title, a price, a date and a link. Photos are links only: the server never
     * downloads them, the browser does.
     */
    detail(id: number) {
      if (!z.number().int().positive().safeParse(id).success) return Promise.resolve(failure("bad_response"));
      return mapped(
        (options.transport ?? cachedFetch)(
          "supost",
          {
            url: SUPOST_MCP_URL,
            init: {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_listing", arguments: { id } } }),
            },
            parse: firstEventData,
            schema: supostToolSchema,
          },
          TTL.listingDetail,
        ),
        (data): SupostDetail | undefined => {
          if (data.result.isError) return undefined;
          let inner: unknown;
          try {
            inner = JSON.parse(data.result.content[0]?.text ?? "");
          } catch {
            return undefined;
          }
          const body = supostDetailBody.safeParse(inner);
          if (!body.success) return undefined;
          const photoUrls = (body.data.photos ?? []).filter((url) => z.url({ protocol: /^https$/ }).safeParse(url).success).slice(0, 12);
          return { description: plainText(body.data.description ?? "").slice(0, 6000), photoUrls };
        },
      );
    },
  };
}
export const supost = createSupost();
