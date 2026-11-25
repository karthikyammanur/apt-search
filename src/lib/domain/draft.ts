// The questions in the draft message to a landlord. Only what is Unknown AND could change the result:
// an Unknown requirement gets one short question, in the order that matters most, at most four in all,
// with the dates taken from the settings. A listing that already fails gets none. Pure, no I/O.

import type { FilterId, FilterResult } from "./filters";
import { fmtDay } from "./format";
import type { Settings } from "./types";

export const MAX_DRAFT_QUESTIONS = 4;

/** What matters most first: a wrong date or place ends a search faster than a missing fee. */
const ORDER: readonly FilterId[] = [
  "move_in",
  "lease",
  "commute",
  "budget",
  "private_bed_bath",
  "furnished",
  "roommates",
  "transit_access",
  "scam_checks",
];

type Settled = Pick<Settings, "moveInEarliest" | "moveInLatest" | "moveOut">;

const askedFields = (result: FilterResult) => new Set(result.questions.filter((q) => q.ask === "landlord").map((q) => q.field));

function shortQuestion(result: FilterResult, settings: Settled, unknownCosts: readonly string[]): string | null {
  const fields = askedFields(result);
  switch (result.filter) {
    case "move_in":
      return `Can I move in between ${fmtDay(settings.moveInEarliest)} and ${fmtDay(settings.moveInLatest)}?`;
    case "lease":
      return `Can I stay until ${fmtDay(settings.moveOut)}? What are the lease terms?`;
    case "commute":
      return fields.size > 0 ? "What is the exact address, or the nearest cross streets?" : null;
    case "budget": {
      const named = unknownCosts.map((label) => label.toLowerCase());
      return named.length > 0 ? `Besides rent, is there a charge for ${named.join(", ")}?` : "What is the total monthly cost, with every fee?";
    }
    case "private_bed_bath": {
      const bedroom = fields.has("privateBedroom");
      const bath = fields.has("privateBath");
      if (bedroom && bath) return "Are the bedroom and bathroom private?";
      return bedroom ? "Is the bedroom private?" : bath ? "Is the bathroom private?" : null;
    }
    case "furnished":
      return "Is it furnished, with a bed, desk and chair?";
    case "roommates":
      return "Who else lives there, and can I video call them first?";
    case "transit_access":
      return "Which bus or train stops are within a 10 minute walk?";
    case "scam_checks":
      return fields.size > 0 ? "Can we do a live video tour before I pay anything?" : null;
    default:
      return null;
  }
}

/**
 * Short questions for the landlord. `unknownCosts` are the labels of the monthly cost lines the post
 * did not state. A failed or passed requirement adds nothing; neither does an Unknown that only
 * asks me to do something myself.
 */
export function draftQuestions(results: readonly FilterResult[], settings: Settled, unknownCosts: readonly string[] = []): string[] {
  if (results.some((r) => r.status === "fail")) return [];
  const questions: string[] = [];
  for (const id of ORDER) {
    const result = results.find((r) => r.filter === id && r.status === "unknown");
    if (!result) continue;
    const text = shortQuestion(result, settings, unknownCosts);
    if (text && !questions.includes(text)) questions.push(text);
  }
  return questions.slice(0, MAX_DRAFT_QUESTIONS);
}

/** "Hi! I'm interested in this listing. Q1 Q2". Null when there is nothing worth asking. */
export function draftMessage(questions: readonly string[]): string | null {
  return questions.length > 0 ? `Hi! I'm interested in this listing. ${questions.join(" ")}` : null;
}
