import { tool } from "ai";
import { z } from "zod";
import { compareListings, getBoard } from "@/lib/queries";
import { fail, money, rowFromBoard, type ToolContext } from "./context";

const CENT_ROWS = new Set(["all_in", "all_in_plus_transit", "rent"]);

export function compareListingsTool(ctx: ToolContext) {
  return tool({
    description: "Compare 2 or 3 listings side by side on cost, commute, transit, lease and every requirement.",
    inputSchema: z.object({ listingIds: z.array(z.number().int().positive()).min(2).max(3) }),
    execute: async ({ listingIds }) => {
      const comparison = await compareListings(listingIds, ctx.options);
      if (comparison.listings.length < 2) return fail(`need at least 2 listings; not found: ${comparison.missing.join(", ")}`);
      const board = await getBoard({}, ctx.options);
      const ids = comparison.listings.map((d) => d.listing.id);
      return {
        ok: true as const,
        listings: ids.flatMap((id) => board.items.filter((i) => i.id === id).map(rowFromBoard)),
        missing: comparison.missing,
        rows: comparison.rows.map((row) => ({
          label: row.label.replace(" (cents)", ""),
          values: row.values.map((v) => (v === null ? "Unknown" : CENT_ROWS.has(row.key) && typeof v === "number" ? money(v) : v)),
          differs: row.differs,
        })),
      };
    },
  });
}
