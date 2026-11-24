import { tool } from "ai";
import { z } from "zod";
import { BUCKETS, USER_STATUSES } from "@/db/schema";
import { getBoard } from "@/lib/queries";
import { rowFromBoard, type ToolContext } from "./context";

export const searchListingsInput = z.object({
  bucket: z.enum(BUCKETS).optional().describe("pass, likely, needs_info or fail. Omit for all."),
  status: z.enum(USER_STATUSES).optional().describe("Karthik's own status: none, shortlisted or rejected."),
  maxAllInCents: z.number().int().positive().optional().describe("Highest all-in monthly cost, integer cents. Listings with an Unknown all-in are left out and counted."),
  area: z.string().min(1).max(60).optional().describe("City or street text to match, such as Palo Alto."),
  sort: z.enum(["rank", "cost"]).default("rank").describe("rank: bucket then score (default). cost: cheapest all-in first."),
  limit: z.number().int().min(1).max(20).default(8),
});

export function searchListingsTool(ctx: ToolContext) {
  return tool({
    description: "Search Karthik's listings. Returns rows with all-in monthly cost, commute, bucket and score, ranked, plus bucket counts.",
    inputSchema: searchListingsInput,
    execute: async (input) => {
      const board = await getBoard({ bucket: input.bucket, status: input.status }, ctx.options);
      let items = board.items;
      if (input.area) {
        const needle = input.area.toLowerCase();
        items = items.filter((i) => `${i.city ?? ""} ${i.address ?? ""} ${i.title ?? ""}`.toLowerCase().includes(needle));
      }
      let unknownCostLeftOut = 0;
      if (input.maxAllInCents !== undefined) {
        const max = input.maxAllInCents;
        unknownCostLeftOut = items.filter((i) => i.allInMonthlyCents === null).length;
        items = items.filter((i) => i.allInMonthlyCents !== null && i.allInMonthlyCents <= max);
      }
      if (input.sort === "cost") {
        items = [...items].sort((a, b) => (a.allInMonthlyCents ?? Infinity) - (b.allInMonthlyCents ?? Infinity) || a.id - b.id);
      }
      return {
        ok: true as const,
        total: items.length,
        rows: items.slice(0, input.limit).map(rowFromBoard),
        unknownCostLeftOut,
        bucketCounts: board.counts,
      };
    },
  });
}
