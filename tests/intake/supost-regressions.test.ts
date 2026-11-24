// The six SUPost posts from the 2026-11-24 live run, end to end with a stub model that gives the
// same replies the real model gave. Four of them were stored wrong (PROGRESS.md, cleanup after
// step 5): "apartment" counted as a private bedroom, date ranges were missed, and "until
// December" became a fixed lease. Each must now store the right facts and land in the right bucket.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enrichment } from "@/db/schema";
import { checkLease } from "@/lib/domain";
import { supostToRaw } from "@/lib/intake/channels/supost";
import { loadFacts } from "@/lib/intake/facts";
import { processRaw } from "@/lib/intake/pipeline";
import type { Extraction } from "@/lib/intake/schema";
import { jsonFixture, makeDeps, settings } from "./helpers";

type Post = {
  label: string;
  title: string;
  price: number;
  created_at: string;
  reply: Extraction;
  expected: Record<string, unknown>;
  absent: string[];
  bucket: string;
  leaseReason?: string;
};

const { posts } = jsonFixture<{ posts: Post[] }>("supost-run-2026-11-24.json");

describe("SUPost posts from the 2026-11-24 live run", () => {
  it("has all six posts", () => {
    expect(posts).toHaveLength(6);
  });

  it.each(posts.map((post, index) => ({ ...post, index })))("$label", async (post) => {
    const raw = supostToRaw({
      id: post.index + 1,
      title: post.title,
      price: post.price,
      created_at: post.created_at,
      url: `https://example.test/supost/${post.index + 1}`,
      stanford_verified: false,
    });
    if (!raw) throw new Error("fixture did not convert");
    const { deps, db } = await makeDeps([{ match: post.title, value: post.reply }]);

    const outcome = await processRaw(deps, raw);
    expect(outcome.status).toBe("stored");
    expect(outcome.bucket).toBe(post.bucket);

    const listingId = outcome.listingId as number;
    const facts = await loadFacts(db, listingId);
    const stored = Object.fromEntries(
      Object.entries(facts).flatMap(([field, fact]) => (fact && field !== "scamChecks" ? [[field, fact.value]] : [])),
    );
    expect(stored).toMatchObject(post.expected);
    for (const field of post.absent) expect(stored, field).not.toHaveProperty(field);
    for (const field of Object.keys(post.expected)) expect(facts[field as keyof typeof facts]?.provenance).toBe("listing");

    const [row] = await db.select().from(enrichment).where(eq(enrichment.listingId, listingId));
    expect(row?.bucket).toBe(post.bucket);

    if (post.leaseReason) {
      const lease = checkLease(facts, settings);
      expect(lease).toMatchObject({ status: "fail", reason: post.leaseReason });
    }
  });
});
