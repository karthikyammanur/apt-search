import { createDb } from "@/db";
import { seedDemo } from "@/db/demo";
import { apiCache } from "@/db/schema";
import { sql } from "drizzle-orm";

export default async function globalSetup() {
  // The webServer has already recreated and migrated this throwaway database.
  // Global setup finishes before any login or screen test can make a request.
  const db = createDb("file:data/e2e.db", "");
  await db.run(sql`PRAGMA busy_timeout = 10000`);
  await seedDemo(db, { reset: true });
  for (const provider of ["google", "geoapify"]) {
    await db
      .insert(apiCache)
      .values({
        provider,
        requestHash: "quota_pause",
        response: "{}",
        fetchedAt: new Date().toISOString(),
        expiresAt: "2099-01-01T00:00:00Z",
      })
      .onConflictDoUpdate({
        target: [apiCache.provider, apiCache.requestHash],
        set: { expiresAt: "2099-01-01T00:00:00Z" },
      });
  }
}
