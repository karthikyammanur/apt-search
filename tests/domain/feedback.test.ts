import { describe, expect, it } from "vitest";
import { applyFeedback, feedbackChangeSchema, type FeedbackChange, type Weights } from "@/lib/domain";
import { equalWeights } from "./fixtures";

const sum = (w: Weights) => Object.values(w).reduce((a, b) => a + b, 0);

describe("applyFeedback", () => {
  it.each([
    {
      name: "small raise, then renormalize",
      changes: [{ factor: "transit_quality", direction: "up", size: "small" }],
      // (0.125 + 0.05) / 1.05
      expected: { transit_quality: 0.175 / 1.05, commute: 0.125 / 1.05 },
      log: ["Raised transit quality from 0.13 to 0.17", "Rescaled the other weights so all weights add up to 1."],
    },
    {
      name: "medium lower",
      changes: [{ factor: "gym", direction: "down", size: "medium" }],
      // (0.125 - 0.1) / 0.9
      expected: { gym: 0.025 / 0.9, commute: 0.125 / 0.9 },
      log: ["Lowered gym from 0.13 to 0.03", "Rescaled the other weights so all weights add up to 1."],
    },
    {
      name: "two changes to one factor are capped at 0.1",
      changes: [
        { factor: "commute", direction: "up", size: "medium" },
        { factor: "commute", direction: "up", size: "small" },
      ],
      expected: { commute: 0.225 / 1.1 },
      log: ["Raised commute from 0.13 to 0.20 (capped at 0.10 per reaction)", "Rescaled the other weights so all weights add up to 1."],
    },
    {
      name: "up and down on one factor cancel",
      changes: [
        { factor: "cafes", direction: "up", size: "small" },
        { factor: "cafes", direction: "down", size: "small" },
      ],
      expected: { cafes: 0.125, commute: 0.125 },
      log: ["Kept cafes at 0.13"],
    },
  ] as { name: string; changes: FeedbackChange[]; expected: Partial<Weights>; log: string[] }[])(
    "$name",
    ({ changes, expected, log }) => {
      const result = applyFeedback(equalWeights, changes);
      for (const [factor, value] of Object.entries(expected)) {
        expect(result.weights[factor as keyof Weights]).toBeCloseTo(value, 12);
      }
      expect(sum(result.weights)).toBeCloseTo(1, 12);
      expect(result.log).toEqual(log);
    },
  );

  it("clamps at 0 before renormalizing", () => {
    const start: Weights = { ...equalWeights, gym: 0.03, commute: 0.22 };
    const result = applyFeedback(start, [{ factor: "gym", direction: "down", size: "medium" }]);
    expect(result.weights.gym).toBe(0);
    expect(result.log[0]).toBe("Lowered gym from 0.03 to 0.00 (a weight cannot go below 0)");
    expect(sum(result.weights)).toBeCloseTo(1, 12);
  });

  it("clamps at 1 before renormalizing", () => {
    const start: Weights = { commute: 0.96, transit_quality: 0.04, budget_headroom: 0, grocery: 0, gym: 0, cafes: 0, reviews_trust: 0, lease_fit: 0 };
    const result = applyFeedback(start, [{ factor: "commute", direction: "up", size: "medium" }]);
    // raw commute clamps to 1, total 1.04
    expect(result.weights.commute).toBeCloseTo(1 / 1.04, 12);
    expect(result.log[0]).toContain("(a weight cannot go above 1)");
  });

  it("normalizes the input first, so a lone weight cannot be zeroed by one reaction", () => {
    const start: Weights = { commute: 0.05, transit_quality: 0, budget_headroom: 0, grocery: 0, gym: 0, cafes: 0, reviews_trust: 0, lease_fit: 0 };
    const result = applyFeedback(start, [{ factor: "commute", direction: "down", size: "medium" }]);
    expect(result.weights.commute).toBe(1);
    expect(result.log).toEqual(["Kept commute at 1.00"]);
  });

  it("reports structured before and after values for the feedback table", () => {
    const result = applyFeedback(equalWeights, [{ factor: "lease_fit", direction: "up", size: "medium" }]);
    expect(result.changes).toEqual([{ factor: "lease_fit", before: 0.125, after: 0.225 / 1.1 }]);
  });

  it("does not change the input", () => {
    const start = { ...equalWeights };
    applyFeedback(start, [{ factor: "gym", direction: "up", size: "small" }]);
    expect(start).toEqual(equalWeights);
  });
});

describe("feedbackChangeSchema", () => {
  it.each([
    { input: { factor: "gym", direction: "up", size: "small" }, ok: true },
    { input: { factor: "gym", direction: "up", size: "large" }, ok: false },
    { input: { factor: "parking", direction: "up", size: "small" }, ok: false },
    { input: { factor: "gym", direction: "up", size: "small", amount: 0.5 }, ok: false },
  ])("$input is valid: $ok", ({ input, ok }) => {
    expect(feedbackChangeSchema.safeParse(input).success).toBe(ok);
  });
});
