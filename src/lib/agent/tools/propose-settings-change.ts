// The model can only propose a settings change. This tool validates it and returns it; nothing
// is written. The chat screen shows an Apply button under the reply, and only that button
// (src/app/chat/actions.ts) applies it, reading the proposal back from the stored tool result.

import { tool } from "ai";
import { z } from "zod";
import { settingsSchema, type Settings } from "@/db/settings-schema";
import { fmtCents, fmtDate } from "@/lib/domain";
import { getSettings, type QueryOptions } from "@/lib/queries";
import type { SettingsChange, SettingsProposal, ToolError } from "../types";
import { fail, type ToolContext } from "./context";

// The office address and region are private or structural, so chat cannot propose them.
export const proposableSettingsSchema = settingsSchema.omit({ officeAddress: true, region: true }).partial().strict();
export type SettingsPatch = z.infer<typeof proposableSettingsSchema>;

const LABELS: Record<keyof SettingsPatch, string> = {
  moveInEarliest: "Earliest move-in",
  moveInLatest: "Latest move-in",
  startDate: "Start date",
  moveOut: "Move-out",
  budgetCapCents: "Budget cap",
  maxCommuteMinutes: "Max commute",
  requirePrivateBedroom: "Private bedroom required",
  requirePrivateBath: "Private bath required",
  requireFurnished: "Furnished required",
};

function show(key: keyof SettingsPatch, value: unknown): string {
  if (key === "budgetCapCents" && typeof value === "number") return fmtCents(value);
  if (key === "maxCommuteMinutes" && typeof value === "number") return `${value} min`;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return fmtDate(value);
  return String(value);
}

/** Validate a patch against the current settings and describe it. Writes nothing. */
export async function buildProposal(patch: unknown, reason: string, options?: QueryOptions): Promise<SettingsProposal | ToolError> {
  const parsed = proposableSettingsSchema.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { settings } = await getSettings(options);
  const merged = settingsSchema.safeParse({ ...settings, ...parsed.data });
  if (!merged.success) return fail(merged.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const keys = (Object.keys(parsed.data) as (keyof SettingsPatch)[]).filter((k) => parsed.data[k] !== settings[k as keyof Settings]);
  if (keys.length === 0) return fail("nothing would change");
  const changes: SettingsChange[] = keys.map((k) => ({ key: k, label: LABELS[k], from: show(k, settings[k]), to: show(k, parsed.data[k]) }));
  return {
    kind: "settings_proposal",
    patch: Object.fromEntries(keys.map((k) => [k, parsed.data[k]])),
    changes,
    reason,
    applied: false,
  };
}

export function proposeSettingsChangeTool(ctx: ToolContext) {
  return tool({
    description:
      "Propose a settings change (budget cap in integer cents, max commute minutes, dates YYYY-MM-DD, required private bedroom, bath or furnished). It does NOT change anything: Karthik sees a button and applies it himself.",
    inputSchema: z.object({
      patch: proposableSettingsSchema,
      reason: z.string().min(1).max(300).describe("Why, in Karthik's words."),
    }),
    execute: async ({ patch, reason }) => {
      const proposal = await buildProposal(patch, reason, ctx.options);
      return "kind" in proposal ? { ok: true as const, ...proposal, note: "Not applied. Karthik must press Apply." } : proposal;
    },
  });
}
