import { tool } from "ai";
import { z } from "zod";
import { FACT_SCHEMAS, type FactField } from "@/lib/intake";
import { recordFact, type AnalysisSnapshot } from "@/lib/queries";
import { fail, money, type ToolContext } from "./context";

// Fields Karthik can learn from a landlord or check himself. Computed ones (commute, stops,
// places, reviews, scam checks) come from providers and are left out.
const RECORDABLE = [
  "rentCents", "shortTermPremiumCents", "mandatoryFeesMonthlyCents", "utilitiesIncluded", "utilitiesMyShareCents",
  "householdSize", "internetIncluded", "internetMonthlyCents", "rentersInsuranceRequired", "rentersInsuranceMonthlyCents",
  "oneTimeFeesCents", "nonRefundableDepositCents", "refundableDepositCents", "availableFrom", "leaseType", "leaseMonths",
  "leaseEnd", "exitClause", "breakFeeCents", "privateBedroom", "privateBath", "furnished", "hasBed", "hasDesk", "hasChair",
  "kitchenEquipped", "hasRoommates", "canMeetRoommates",
] as const satisfies readonly FactField[];

const fields = RECORDABLE.filter((f) => f in FACT_SCHEMAS);

const show = (s: AnalysisSnapshot) => ({
  bucket: s.bucket ?? "Unknown",
  score: s.score ?? "Unknown",
  allInMonthly: money(s.allInMonthlyCents),
  allInPlusTransit: money(s.allInPlusTransitCents),
});

export function recordFactTool(ctx: ToolContext) {
  return tool({
    description: "Record a fact Karthik learned (provenance me) or a landlord told him (provenance landlord). Money is integer cents, dates YYYY-MM-DD, yes/no as true/false. Re-runs cost, filters and score and returns what changed.",
    inputSchema: z.object({
      listingId: z.number().int().positive(),
      field: z.enum(fields as [FactField, ...FactField[]]),
      value: z.union([z.number(), z.string(), z.boolean()]),
      provenance: z.enum(["me", "landlord"]),
      note: z.string().max(300).optional(),
    }),
    execute: async (input) => {
      const result = await recordFact(input, ctx.options);
      if (!result.ok) return fail(result.error);
      const { before, after, changed } = result.data;
      return { ok: true as const, listingId: input.listingId, field: input.field, before: show(before), after: show(after), changed };
    },
  });
}
