import { tool } from "ai";
import { z } from "zod";
import { LEAD_STATUSES } from "@/db/schema";
import { getLeads, updateRoommateLeadStatus } from "@/lib/queries";
import { untrusted } from "../prompt";
import { fail, money, type ToolContext } from "./context";

export function listRoommateLeadsTool(ctx: ToolContext) {
  return tool({
    description: "List people looking for a roommate (from group posts), newest first, with their status.",
    inputSchema: z.object({ status: z.enum(LEAD_STATUSES).optional() }),
    execute: async ({ status }) => {
      const leads = (await getLeads(ctx.options)).filter((l) => !status || l.status === status);
      return {
        ok: true as const,
        leads: leads.slice(0, 20).map((l) => ({
          id: l.id,
          name: l.posterName ?? "Unknown",
          group: l.groupName,
          datesWanted: l.datesWanted ?? "Unknown",
          budget: money(l.budgetCents),
          status: l.status,
          notes: l.notes,
          post: l.text ? untrusted(l.text.slice(0, 600), "post_text") : null,
        })),
      };
    },
  });
}

export function updateRoommateLeadStatusTool(ctx: ToolContext) {
  return tool({
    description: "Move a roommate lead to new, messaged, talking or not_a_fit, with an optional note. Karthik does the messaging himself.",
    inputSchema: z.object({
      leadId: z.number().int().positive(),
      status: z.enum(LEAD_STATUSES),
      notes: z.string().max(500).optional(),
    }),
    execute: async ({ leadId, status, notes }) => {
      const result = await updateRoommateLeadStatus({ id: leadId, status, notes }, ctx.options);
      return result.ok ? { ok: true as const, id: result.data.id, status: result.data.status } : fail(result.error);
    },
  });
}
