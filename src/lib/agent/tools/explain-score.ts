import { tool } from "ai";
import { fmtWeight } from "@/lib/domain";
import { getListing } from "@/lib/queries";
import { fail, type ToolContext } from "./context";
import { listingIdInput } from "./get-listing";

const round1 = (x: number) => Math.round(x * 10) / 10;

export function explainScoreTool(ctx: ToolContext) {
  return tool({
    description: "Why a listing has its score: for each factor, its weight, its 0 to 1 score, points earned and points lost out of 100, and the basis. Unknown factors earn nothing.",
    inputSchema: listingIdInput,
    execute: async ({ listingId }) => {
      const detail = await getListing(listingId, ctx.options);
      if (!detail) return fail("no such listing");
      const breakdown = detail.scoreBreakdown;
      if (!breakdown) {
        return fail(detail.bucket === "fail" ? "not scored: it failed a requirement first" : "not scored yet");
      }
      return {
        ok: true as const,
        listingId,
        title: detail.listing.title,
        score: breakdown.score,
        factors: breakdown.factors.map((f) => ({
          factor: f.label,
          weight: fmtWeight(f.weight),
          score: f.score === null ? "Unknown" : round1(f.score),
          // Earned comes from the domain breakdown; lost is the rest of that factor's share of 100.
          pointsEarned: f.points === null ? 0 : round1(f.points),
          pointsLost: f.points === null ? "Unknown" : round1(f.weight * 100 - f.points),
          basis: f.basis,
        })),
        strengths: detail.explanation?.strengths.map((s) => s.label) ?? [],
        weakness: detail.explanation?.weakness?.label ?? null,
      };
    },
  });
}
