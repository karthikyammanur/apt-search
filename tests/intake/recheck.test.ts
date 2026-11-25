// `npm run recheck` reads each stored post again from its saved text and redoes cost, filters and score,
// without fetching anything new.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { facts, listings } from "@/db/schema";
import { loadFacts } from "@/lib/intake/facts";
import { processRaw } from "@/lib/intake/pipeline";
import { recheckListings } from "@/lib/intake/recheck";
import type { RawListing } from "@/lib/intake/types";
import { extraction, makeDeps, stubLlm, type Canned } from "./helpers";

const post = (text: string, over: Partial<RawListing> = {}): RawListing => ({
  channel: "paste",
  source: "craigslist",
  url: `https://example.test/${encodeURIComponent(text.slice(0, 12))}`,
  title: undefined,
  text,
  photoUrls: [],
  photoHashes: [],
  ...over,
});

const TEXT = "Room at 340 Cedar Ln, Palo Alto. $1,950 a month. Starting from Feb or March. Furnished, private bath.";
const first: Canned = {
  match: "340 Cedar Ln",
  value: extraction({
    post_type: "room_offered",
    type: "room",
    address: "340 Cedar Ln, Palo Alto, CA 94306",
    city: "Palo Alto",
    rent_usd: 1950,
    available_from: "2027-01-04",
    furnished: true,
    private_bath: true,
    private_bedroom: true,
  }),
};
// What the improved reading of the same text says.
const better: Canned = { match: "340 Cedar Ln", value: { ...first.value, available_from: "2027-02-01" } };

describe("recheck", () => {
  it("reads the saved text again, replaces what the post states, and redoes the analysis", async () => {
    const { deps, db } = await makeDeps([first]);
    expect((await processRaw(deps, post(TEXT))).status).toBe("stored");
    const [row] = await db.select().from(listings);
    expect((await loadFacts(db, row!.id)).availableFrom?.value).toBe("2027-01-04");

    deps.llm = stubLlm([better]).llm;
    const [result] = await recheckListings(deps);
    expect(result).toMatchObject({ id: row!.id, changed: ["availableFrom"] });
    expect((await loadFacts(db, row!.id)).availableFrom?.value).toBe("2027-02-01");
    expect(result!.after).toBe("fail");
    expect(result!.before).not.toBe("fail");
  });

  it("fetches nothing: no map service is called", async () => {
    const { deps, calls } = await makeDeps([first]);
    await processRaw(deps, post(TEXT));
    const before = { ...calls, geocode: [...calls.geocode], walkBike: [...calls.walkBike] };
    await recheckListings(deps);
    expect(calls).toEqual(before);
  });

  it("keeps the facts that did not come from the post, such as a map answer", async () => {
    const { deps, db } = await makeDeps([first]);
    await processRaw(deps, post(TEXT));
    const [row] = await db.select().from(listings);
    const apiBefore = await db.select().from(facts).where(eq(facts.provenance, "api"));
    expect(apiBefore.length).toBeGreaterThan(0);
    await recheckListings(deps);
    expect(await db.select().from(facts).where(eq(facts.provenance, "api"))).toHaveLength(apiBefore.length);
    expect((await loadFacts(db, row!.id)).commuteMinutes?.provenance).toBe("api");
  });

  it("drops a stated value the text no longer supports instead of keeping it", async () => {
    const { deps, db } = await makeDeps([first]);
    await processRaw(deps, post(TEXT));
    const [row] = await db.select().from(listings);
    deps.llm = stubLlm([{ match: "340 Cedar Ln", value: { ...first.value, furnished: undefined } as never }]).llm;
    await recheckListings(deps);
    expect((await loadFacts(db, row!.id)).furnished).toBeNull();
  });

  it("keeps a channel's own price when the text does not repeat it", async () => {
    const { deps, db } = await makeDeps([first]);
    await processRaw(deps, post(TEXT, { source: "supost", prefill: { facts: { rentCents: 195000 } } }));
    const [row] = await db.select().from(listings);
    deps.llm = stubLlm([{ match: "340 Cedar Ln", value: { ...first.value, rent_usd: undefined } as never }]).llm;
    await recheckListings(deps);
    expect((await loadFacts(db, row!.id)).rentCents?.value).toBe(195000);
  });

  it("leaves a listing as it was when the model cannot read the text, and still redoes the numbers", async () => {
    const { deps, db } = await makeDeps([first]);
    await processRaw(deps, post(TEXT));
    const [row] = await db.select().from(listings);
    deps.llm = stubLlm([]).llm;
    const [result] = await recheckListings(deps);
    expect(result!.note).toContain("could not read the text again");
    expect(result!.changed).toEqual([]);
    expect((await loadFacts(db, row!.id)).availableFrom?.value).toBe("2027-01-04");
  });

  it("reports what is still Unknown", async () => {
    const { deps } = await makeDeps([first]);
    await processRaw(deps, post(TEXT));
    const [result] = await recheckListings(deps);
    expect(result!.unknowns.length).toBeGreaterThan(0);
  });
});
