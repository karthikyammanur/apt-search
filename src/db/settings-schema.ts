// One Zod schema for my editable settings. It validates the seed file (local or example),
// every read from the settings table and every write to it.

import { z } from "zod";

const isoDate = z.iso.date();

export const settingsSchema = z
  .object({
    officeAddress: z.string().min(1),
    region: z.string().min(1),
    moveInEarliest: isoDate,
    moveInLatest: isoDate,
    startDate: isoDate,
    moveOut: isoDate,
    /** Integer cents. */
    budgetCapCents: z.number().int().positive(),
    /** Integer minutes. */
    maxCommuteMinutes: z.number().int().positive(),
    requirePrivateBedroom: z.boolean(),
    requirePrivateBath: z.boolean(),
    requireFurnished: z.boolean(),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const SETTING_KEYS = Object.keys(settingsSchema.shape) as SettingKey[];
