import { tool } from "ai";
import { z } from "zod";
import { setUserStatus } from "@/lib/queries";
import { fail, type ToolContext } from "./context";

export function setListingStatusTool(ctx: ToolContext) {
  return tool({
    description: "Shortlist or reject a listing on Karthik's board, with his reason in his words.",
    inputSchema: z.object({
      listingId: z.number().int().positive(),
      status: z.enum(["shortlisted", "rejected"]),
      reason: z.string().min(1).max(300),
    }),
    execute: async (input) => {
      const result = await setUserStatus(input, ctx.options);
      return result.ok ? { ok: true as const, ...result.data } : fail(result.error);
    },
  });
}
