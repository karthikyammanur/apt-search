import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from "./index";

/** Apply every pending migration in src/db/migrations. Safe to run repeatedly. */
export async function runMigrations(db: Db, root: string = process.cwd()): Promise<void> {
  await migrate(db, { migrationsFolder: path.join(root, "src", "db", "migrations") });
}
