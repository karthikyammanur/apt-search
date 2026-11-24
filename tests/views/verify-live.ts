// Companion to the opt-in live browser check. Prints counts only, never listing text.
import { eq } from "drizzle-orm";
import { createDb, channelRuns, listings } from "@/db";

async function main() {
  const db = createDb("file:data/step7-live.db", "");
  const captures = await db.select().from(channelRuns).where(eq(channelRuns.channel, "extension"));
  const stored = await db
    .select({ id: listings.id, source: listings.source, url: listings.url })
    .from(listings);
  const actual = stored.filter(
    (row) =>
      row.source === "supost.com" &&
      row.url &&
      /^\/posts?\/[^/]+\/?$/.test(new URL(row.url).pathname),
  );
  if (!actual.length || !captures.some((run) => run.itemsNew > 0 && run.error === null))
    throw new Error("No successful live capture found");
  console.log(
    `Database evidence: ${actual.length} SUPost extension listing; successful extension run recorded.`,
  );
}
main().catch(() => {
  console.error("Live capture has not been recorded yet.");
  process.exitCode = 1;
});
