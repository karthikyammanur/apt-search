// A reaction in Karthik's words becomes a few small weight changes. The model only picks the
// factor, direction and step size; applyFeedback in the domain caps each move at 0.1 and
// renormalises, and the queries layer stores the event so it can be shown and undone.

import { tool } from "ai";
import { z } from "zod";
import { applyFeedback, feedbackChangeSchema, FACTOR_LABELS, fmtWeight, type Weights } from "@/lib/domain";
import { getBoard, getSettings, saveFeedbackEvent, undoLastFeedbackEvent, type QueryOptions } from "@/lib/queries";
import type { FeedbackOutput, MovedListing, WeightChangeLine } from "../types";
import { fail, type ToolContext } from "./context";

async function currentWeights(options?: QueryOptions): Promise<Weights> {
  const { weights } = await getSettings(options);
  return Object.fromEntries(weights.map((w) => [w.factor, w.weight])) as Weights;
}

async function scores(options?: QueryOptions) {
  const board = await getBoard({}, options);
  return new Map(board.items.map((i) => [i.id, { title: i.title, score: i.score }]));
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Gym weight 0.12 to 0.06, cafes 0.06 to 0.12." */
export function weightLine(changes: WeightChangeLine[]): string {
  if (changes.length === 0) return "No weight changed.";
  const parts = changes.map((c, i) => `${i === 0 ? capitalise(c.label) : c.label}${i === 0 ? " weight" : ""} ${fmtWeight(c.before)} to ${fmtWeight(c.after)}`);
  return `${parts.join(", ")}.`;
}

/** Listings whose score changed, biggest move first (at most 5). */
export function movedListings(
  before: Map<number, { title: string | null; score: number | null }>,
  after: Map<number, { title: string | null; score: number | null }>,
): MovedListing[] {
  const moved: (MovedListing & { size: number })[] = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a || a.score === b.score) continue;
    const size = a.score !== null && b.score !== null ? Math.abs(a.score - b.score) : Infinity;
    moved.push({ id, title: b.title, scoreBefore: b.score, scoreAfter: a.score, size });
  }
  return moved.sort((x, y) => y.size - x.size || x.id - y.id).slice(0, 5).map(({ id, title, scoreBefore, scoreAfter }) => ({ id, title, scoreBefore, scoreAfter }));
}

export function giveFeedbackTool(ctx: ToolContext) {
  return tool({
    description:
      "Turn Karthik's reaction (\"too far from Caltrain\", \"gym does not matter\") into one to three small weight changes. Returns the weights before and after and which listings moved. Factors: commute, transit_quality, budget_headroom, grocery, gym, cafes, reviews_trust, lease_fit.",
    inputSchema: z.object({
      reason: z.string().min(1).max(300).describe("His words, unchanged."),
      listingId: z.number().int().positive().optional(),
      changes: z.array(feedbackChangeSchema).min(1).max(3),
    }),
    execute: async (input) => {
      const weightsBefore = await currentWeights(ctx.options);
      const result = applyFeedback(weightsBefore, input.changes);
      if (result.changes.length === 0) return fail(result.log.join(" "));
      const scoresBefore = await scores(ctx.options);
      const saved = await saveFeedbackEvent({ listingId: input.listingId ?? null, reason: input.reason, weightsAfter: result.weights }, ctx.options);
      if (!saved.ok) return fail(saved.error);
      const changes: WeightChangeLine[] = result.changes.map((c) => ({ factor: c.factor, label: FACTOR_LABELS[c.factor], before: c.before, after: c.after }));
      const output: FeedbackOutput = {
        kind: "feedback",
        eventId: saved.data.id,
        reason: saved.data.reason,
        changes,
        summary: weightLine(changes),
        log: result.log,
        moved: movedListings(scoresBefore, await scores(ctx.options)),
      };
      return { ok: true as const, ...output, weightsBefore: saved.data.weightsBefore, weightsAfter: saved.data.weightsAfter };
    },
  });
}

/** Undo the latest feedback event that is not undone yet. Shared by the tool and the Undo button. */
export async function undoFeedback(options?: QueryOptions) {
  const scoresBefore = await scores(options);
  const event = await undoLastFeedbackEvent(options);
  if (!event) return fail("nothing to undo");
  const changes: WeightChangeLine[] = (Object.keys(event.weightsAfter) as (keyof Weights)[])
    .filter((f) => Math.abs(event.weightsAfter[f] - event.weightsBefore[f]) > 1e-9)
    .map((f) => ({ factor: f, label: FACTOR_LABELS[f], before: event.weightsAfter[f], after: event.weightsBefore[f] }))
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, 2);
  return {
    ok: true as const,
    kind: "feedback_undone" as const,
    eventId: event.id,
    reason: event.reason,
    summary: `Undone. ${weightLine(changes)}`,
    weightsRestored: event.weightsBefore,
    moved: movedListings(scoresBefore, await scores(options)),
  };
}

export function undoFeedbackTool(ctx: ToolContext) {
  return tool({
    description: "Undo the last weight change from feedback, restoring the weights before it.",
    inputSchema: z.object({}),
    execute: async () => undoFeedback(ctx.options),
  });
}
