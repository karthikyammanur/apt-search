// Seed logic, kept separate from the runnable script (seed.ts) so tests can call it.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SOFT_FACTORS, STARTING_WEIGHT } from "./defaults";
import type { Db } from "./index";
import { preferences, settings } from "./schema";
import { settingsSchema, type Settings } from "./settings-schema";

export const LOCAL_SETTINGS_FILE = "settings.local.json";
export const EXAMPLE_SETTINGS_FILE = "settings.example.json";

/**
 * Read settings from config/settings.local.json if it exists, else the example file.
 * Both go through the same Zod schema. Error text lists field names only, never values,
 * so private values cannot leak into logs.
 */
export function loadSettingsFile(configDir: string): { file: string; values: Settings } {
  const local = path.join(configDir, LOCAL_SETTINGS_FILE);
  const file = existsSync(local) ? LOCAL_SETTINGS_FILE : EXAMPLE_SETTINGS_FILE;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(configDir, file), "utf8"));
  } catch {
    throw new Error(`${file} is missing or is not valid JSON.`);
  }

  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${file} failed validation: ${problems}`);
  }
  return { file, values: parsed.data };
}

export type SeedResult = { file: string; settingsWritten: number; weightsWritten: number };

/**
 * Write settings and the equal starting weights.
 * Without `overwrite`, existing rows are kept, so re-running never undoes edits made in the app.
 * With `overwrite`, settings are replaced from the file. Learned weights are never overwritten.
 */
export async function seedDatabase(
  db: Db,
  options: { configDir: string; overwrite?: boolean },
): Promise<SeedResult> {
  const { file, values } = loadSettingsFile(options.configDir);
  const updatedAt = new Date().toISOString();

  let settingsWritten = 0;
  for (const [key, value] of Object.entries(values)) {
    const insert = db.insert(settings).values({ key, value, updatedAt });
    const rows = options.overwrite
      ? await insert
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
          .returning({ key: settings.key })
      : await insert.onConflictDoNothing().returning({ key: settings.key });
    settingsWritten += rows.length;
  }

  let weightsWritten = 0;
  for (const factor of SOFT_FACTORS) {
    const rows = await db
      .insert(preferences)
      .values({ key: factor, kind: "soft", value: null, weight: STARTING_WEIGHT, setBy: null })
      .onConflictDoNothing()
      .returning({ key: preferences.key });
    weightsWritten += rows.length;
  }

  return { file, settingsWritten, weightsWritten };
}
