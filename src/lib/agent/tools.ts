// Every tool the chat assistant can call. None can send, email, post, apply or pay: the guard in
// tests/guards/tool-registry.test.ts checks the names, and none of the tools below reaches a
// provider that could. Settings change only through the Apply button, never through a tool.

import { addListingFromTextTool } from "./tools/add-listing-from-text";
import { compareListingsTool } from "./tools/compare-listings";
import type { ToolContext } from "./tools/context";
import { draftMessageTool } from "./tools/draft-message";
import { explainScoreTool } from "./tools/explain-score";
import { getListingTool } from "./tools/get-listing";
import { giveFeedbackTool, undoFeedbackTool } from "./tools/give-feedback";
import { proposeSettingsChangeTool } from "./tools/propose-settings-change";
import { recordFactTool } from "./tools/record-fact";
import { listRoommateLeadsTool, updateRoommateLeadStatusTool } from "./tools/roommate-leads";
import { searchListingsTool } from "./tools/search-listings";
import { setListingStatusTool } from "./tools/set-listing-status";

export type { ToolContext } from "./tools/context";

export function createTools(ctx: ToolContext = {}) {
  return {
    search_listings: searchListingsTool(ctx),
    get_listing: getListingTool(ctx),
    compare_listings: compareListingsTool(ctx),
    explain_score: explainScoreTool(ctx),
    add_listing_from_text: addListingFromTextTool(ctx),
    record_fact: recordFactTool(ctx),
    set_listing_status: setListingStatusTool(ctx),
    give_feedback: giveFeedbackTool(ctx),
    undo_feedback: undoFeedbackTool(ctx),
    draft_message: draftMessageTool(ctx),
    propose_settings_change: proposeSettingsChangeTool(ctx),
    list_roommate_leads: listRoommateLeadsTool(ctx),
    update_roommate_lead_status: updateRoommateLeadStatusTool(ctx),
  };
}

export type AgentTools = ReturnType<typeof createTools>;
export type ToolName = keyof AgentTools;

/** The registry the guard reads. Built with the shared database; nothing runs until a call. */
export const toolRegistry: AgentTools = createTools();
