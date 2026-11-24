import { tool } from "ai";
import { z } from "zod";
import { createDeps, intakeFromText } from "@/lib/intake";
import { getBoard } from "@/lib/queries";
import type { ListingCard } from "../types";
import { fail, minutes, money, rowFromBoard, type ToolContext } from "./context";

export function addListingFromTextTool(ctx: ToolContext) {
  return tool({
    description: "Add a listing Karthik pasted. Runs the intake pipeline (extraction, cost, commute, filters, score) and returns the new listing's card with its id and bucket.",
    inputSchema: z.object({ text: z.string().min(20).max(20_000).describe("The full pasted post, unchanged.") }),
    execute: async ({ text }) => {
      const deps = await (ctx.intakeDeps ?? (() => createDeps({ db: ctx.options?.db, now: ctx.options?.now })))();
      const outcome = await intakeFromText(deps, text);
      if (outcome.listingId === null) {
        return fail(`not added (${outcome.status})${outcome.note ? `: ${outcome.note}` : ""}`);
      }
      const board = await getBoard({}, ctx.options);
      const item = board.items.find((i) => i.id === outcome.listingId);
      const base = item
        ? rowFromBoard(item)
        : {
            id: outcome.listingId,
            title: null,
            city: null,
            bucket: outcome.bucket,
            score: outcome.score,
            allInMonthlyCents: outcome.allInMonthlyCents,
            allInMonthly: money(outcome.allInMonthlyCents),
            commuteMinutes: outcome.commuteMinutes,
            commute: minutes(outcome.commuteMinutes),
            note: null,
            userStatus: "none" as const,
          };
      const card: ListingCard = { ...base, intakeStatus: outcome.status, intakeNote: outcome.note };
      return { ok: true as const, card };
    },
  });
}
