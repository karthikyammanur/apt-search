// Typed access to the settings table. Zod validates every read and every write.

import type { Db } from "./index";
import { settings } from "./schema";
import { settingsSchema, type SettingKey, type Settings } from "./settings-schema";

/** Read all settings. Throws if a row is missing or no longer matches the schema. */
export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(settings);
  return settingsSchema.parse(Object.fromEntries(rows.map((row) => [row.key, row.value])));
}

/** Write one setting after validating it against that key's schema. */
export async function setSetting<K extends SettingKey>(
  db: Db,
  key: K,
  value: Settings[K],
): Promise<void> {
  const parsed: unknown = settingsSchema.shape[key].parse(value);
  const updatedAt = new Date().toISOString();
  await db
    .insert(settings)
    .values({ key, value: parsed, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed, updatedAt } });
}
