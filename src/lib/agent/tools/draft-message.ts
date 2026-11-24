// Drafts are built from templates and stored data, not written by the model, so a draft never
// carries a number the database does not have. The screen shows the text with a Copy button;
// nothing here sends it.

import { tool } from "ai";
import { z } from "zod";
import { fmtDate } from "@/lib/domain";
import { getLeads, getListing, getSettings } from "@/lib/queries";
import type { DraftOutput } from "../types";
import { fail, type ToolContext } from "./context";

export const DRAFT_PURPOSES = ["ask_missing_facts", "request_video_tour", "roommate_intro", "call_prep"] as const;
type Purpose = (typeof DRAFT_PURPOSES)[number];

const CALL_PREP = [
  "What are your sleep and work schedules?",
  "How do you split cleaning?",
  "How often do you have guests over?",
  "How do you feel about noise in the evening?",
  "How do you share the kitchen and fridge?",
  "Does anyone smoke?",
  "How are bills split?",
];

const listingDraft = (title: string | null, purpose: Purpose, questions: string[]): string => {
  const name = title ? `your listing "${title}"` : "your listing";
  if (purpose === "request_video_tour") {
    return [
      "Hi,",
      "",
      `I'm interested in ${name}. I'm relocating for work and can't visit in person yet. Could we do a live video tour this week? I'm flexible on times.`,
      "",
      "Thanks,",
      "Karthik",
    ].join("\n");
  }
  const asks = questions.length > 0 ? questions : ["Is it still available for my dates?"];
  return [
    "Hi,",
    "",
    `I'm interested in ${name}. Before I go further, could you tell me:`,
    ...asks.map((q) => `- ${q}`),
    "",
    "I'd also like a live video tour before signing anything. Thanks,",
    "Karthik",
  ].join("\n");
};

export function draftMessageTool(ctx: ToolContext) {
  return tool({
    description:
      "Draft a message for Karthik to copy and send himself: ask a landlord the open questions on a listing, ask for a live video tour, introduce himself to a roommate lead, or a call-prep question list. Returns text only.",
    inputSchema: z
      .object({
        listingId: z.number().int().positive().optional(),
        leadId: z.number().int().positive().optional(),
        purpose: z.enum(DRAFT_PURPOSES),
      })
      .refine((v) => (v.listingId === undefined) !== (v.leadId === undefined), "give exactly one of listingId or leadId"),
    execute: async ({ listingId, leadId, purpose }) => {
      if (listingId !== undefined) {
        const detail = await getListing(listingId, ctx.options);
        if (!detail) return fail("no such listing");
        if (purpose === "roommate_intro") return fail("roommate_intro needs a leadId");
        const questions = (detail.filters?.questions ?? []).filter((q) => q.ask === "landlord").map((q) => q.text);
        const text = purpose === "call_prep" ? CALL_PREP.map((q) => `- ${q}`).join("\n") : listingDraft(detail.listing.title, purpose, questions);
        const draft: DraftOutput = { kind: "draft", to: detail.listing.title ?? `listing ${listingId}`, purpose, text };
        return { ok: true as const, ...draft };
      }
      const lead = (await getLeads(ctx.options)).find((l) => l.id === leadId);
      if (!lead) return fail("no such roommate lead");
      const { settings } = await getSettings(ctx.options);
      const stay = `${fmtDate(settings.moveInEarliest)} to ${fmtDate(settings.moveOut)}`;
      const who = lead.posterName ? `Hi ${lead.posterName.split(" ")[0]},` : "Hi,";
      const text =
        purpose === "call_prep"
          ? CALL_PREP.map((q) => `- ${q}`).join("\n")
          : [
              who,
              "",
              `I saw your post${lead.groupName ? ` in ${lead.groupName}` : ""} about looking for a roommate${lead.datesWanted ? ` (${lead.datesWanted})` : ""}. I am moving to the area for work from ${stay} and am looking for a furnished place near transit.`,
              "",
              "Would you be up for a quick video call to see if we'd be a good fit? Happy to share more about my schedule and habits.",
              "",
              "Thanks,",
              "Karthik",
            ].join("\n");
      const draft: DraftOutput = { kind: "draft", to: lead.posterName ?? `lead ${lead.id}`, purpose, text };
      return { ok: true as const, ...draft };
    },
  });
}
