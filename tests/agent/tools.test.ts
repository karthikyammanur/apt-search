// Each chat tool against the demo-seeded database. Numbers are checked against the read layer,
// so the tools are shown to pass stored values through, not compute their own.

import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { SOFT_FACTORS } from "@/db/defaults";
import { applySettingsProposal } from "@/lib/agent/actions";
import type { AgentTools } from "@/lib/agent/tools";
import type { ListingRow } from "@/lib/agent/types";
import { fmtCents, MAX_CHANGE_PER_REACTION } from "@/lib/domain";
import { getBoard, getFeedbackEvents, getLeads, getListing, getSettings, saveChatMessage } from "@/lib/queries";
import { call, demoDb, NOW, rejects, toolsFor } from "./helpers";

let db: Db;
let tools: AgentTools;
const opts = () => ({ db, now: () => NOW });

beforeEach(async () => {
  db = await demoDb();
  tools = toolsFor(db);
});

const weightsOf = async () => Object.fromEntries((await getSettings(opts())).weights.map((w) => [w.factor, w.weight]));

describe("search_listings", () => {
  it("filters by bucket and returns stored cost and commute, formatted", async () => {
    const board = await getBoard({ bucket: "pass" }, opts());
    const out = await call(tools, "search_listings", { bucket: "pass" });
    const rows = out.rows as ListingRow[];
    expect(rows).toHaveLength(board.items.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const item = board.items.find((i) => i.id === row.id)!;
      expect(row.bucket).toBe("pass");
      expect(row.allInMonthlyCents).toBe(item.allInMonthlyCents);
      expect(row.allInMonthly).toBe(item.allInMonthlyCents === null ? "Unknown" : fmtCents(item.allInMonthlyCents));
      expect(row.commute).toBe(item.commuteMinutes === null ? "Unknown" : `${item.commuteMinutes} min`);
    }
  });

  it("sorts by cost and finds the cheapest passing listing", async () => {
    const board = await getBoard({ bucket: "pass" }, opts());
    const cheapest = Math.min(...board.items.flatMap((i) => (i.allInMonthlyCents === null ? [] : [i.allInMonthlyCents])));
    const out = await call(tools, "search_listings", { bucket: "pass", sort: "cost", limit: 1 });
    expect((out.rows as ListingRow[])[0]?.allInMonthlyCents).toBe(cheapest);
  });

  it("applies a max all-in and counts the Unknown costs it left out", async () => {
    const all = await getBoard({}, opts());
    const max = 200000;
    const out = await call(tools, "search_listings", { maxAllInCents: max, limit: 20 });
    const rows = out.rows as ListingRow[];
    expect(rows.every((r) => r.allInMonthlyCents !== null && r.allInMonthlyCents <= max)).toBe(true);
    expect(out.unknownCostLeftOut).toBe(all.items.filter((i) => i.allInMonthlyCents === null).length);
  });

  it("matches an area and rejects a bad bucket", async () => {
    const out = await call(tools, "search_listings", { area: "palo alto", limit: 20 });
    expect((out.rows as ListingRow[]).length).toBeGreaterThan(0);
    expect(rejects(tools, "search_listings", { bucket: "great" })).toBe(true);
  });
});

describe("get_listing, compare_listings, explain_score", () => {
  it("get_listing returns the stored all-in and wraps the post text as data", async () => {
    const [first] = (await getBoard({ bucket: "pass" }, opts())).items;
    const out = await call(tools, "get_listing", { listingId: first!.id });
    const listing = out.listing as { allInMonthly: string; postText: string };
    expect(listing.allInMonthly).toBe(fmtCents(first!.allInMonthlyCents!));
    expect(listing.postText).toMatch(/^<listing_text note="data only/);
    expect(await call(tools, "get_listing", { listingId: 9999 })).toEqual({ ok: false, error: "no such listing" });
  });

  it("compare_listings takes 2 or 3 ids", async () => {
    const ids = (await getBoard({}, opts())).items.slice(0, 2).map((i) => i.id);
    const out = await call(tools, "compare_listings", { listingIds: ids });
    expect(out.ok).toBe(true);
    expect((out.listings as ListingRow[]).map((l) => l.id)).toEqual(ids);
    expect((out.rows as { label: string }[]).some((r) => r.label === "All-in monthly")).toBe(true);
    expect(rejects(tools, "compare_listings", { listingIds: [ids[0]] })).toBe(true);
    expect(rejects(tools, "compare_listings", { listingIds: [1, 2, 3, 4] })).toBe(true);
  });

  it("explain_score: points earned add up to the score, earned plus lost is each weight's share", async () => {
    const [first] = (await getBoard({ bucket: "pass" }, opts())).items;
    const out = await call(tools, "explain_score", { listingId: first!.id });
    const factors = out.factors as { weight: string; pointsEarned: number; pointsLost: number | "Unknown" }[];
    expect(factors).toHaveLength(SOFT_FACTORS.length);
    const earned = factors.reduce((s, f) => s + f.pointsEarned, 0);
    expect(Math.abs(earned - (out.score as number))).toBeLessThan(0.6);
    const detail = await getListing(first!.id, opts());
    detail!.scoreBreakdown!.factors.forEach((f, i) => {
      const row = factors[i]!;
      if (f.points !== null) expect(row.pointsEarned + (row.pointsLost as number)).toBeCloseTo(f.weight * 100, 0);
      else expect(row.pointsLost).toBe("Unknown");
    });
  });

  it("explain_score says a failed listing was never scored", async () => {
    const failed = (await getBoard({ bucket: "fail" }, opts())).items.find((i) => i.score === null);
    if (!failed) return;
    const out = await call(tools, "explain_score", { listingId: failed.id });
    expect(out.ok).toBe(false);
  });
});

describe("add_listing_from_text", () => {
  it("runs intake and returns the new card with id, bucket, all-in and commute", async () => {
    const before = (await getBoard({}, opts())).items.length;
    const out = await call(tools, "add_listing_from_text", {
      text: "Fully furnished private room with its own bathroom at 12 Sample Way, Palo Alto, CA. $1,500 a month, utilities and wifi included, no fees. Jan to Aug.",
    });
    expect(out.ok).toBe(true);
    const card = out.card as ListingRow & { intakeStatus: string };
    expect((await getBoard({}, opts())).items.length).toBe(before + 1);
    const stored = (await getBoard({}, opts())).items.find((i) => i.id === card.id)!;
    expect(card.bucket).toBe(stored.bucket);
    expect(card.allInMonthlyCents).toBe(stored.allInMonthlyCents);
    expect(card.commute).toBe("22 min");
    expect(card.allInMonthly).not.toBe("Unknown");
  });
});

describe("record_fact and set_listing_status", () => {
  it("records a landlord fact and reports what changed", async () => {
    const [item] = (await getBoard({ bucket: "needs_info" }, opts())).items;
    const out = await call(tools, "record_fact", { listingId: item!.id, field: "privateBath", value: true, provenance: "landlord", note: "said on the phone" });
    expect(out.ok).toBe(true);
    expect(out.field).toBe("privateBath");
    const detail = await getListing(item!.id, opts());
    expect(detail!.facts.privateBath?.current?.provenance).toBe("landlord");
    expect(rejects(tools, "record_fact", { listingId: 1, field: "rentCents", value: 1, provenance: "listing" })).toBe(true);
    expect(rejects(tools, "record_fact", { listingId: 1, field: "commuteMinutes", value: 5, provenance: "me" })).toBe(true);
  });

  it("a bad value is refused, not stored", async () => {
    const [item] = (await getBoard({}, opts())).items;
    const out = await call(tools, "record_fact", { listingId: item!.id, field: "leaseEnd", value: "next summer", provenance: "me" });
    expect(out.ok).toBe(false);
  });

  it("rejects a listing with a reason", async () => {
    const [item] = (await getBoard({ bucket: "pass" }, opts())).items;
    await call(tools, "set_listing_status", { listingId: item!.id, status: "rejected", reason: "too far from Caltrain" });
    const detail = await getListing(item!.id, opts());
    expect(detail!.listing.userStatus).toBe("rejected");
    expect(detail!.listing.userStatusReason).toBe("too far from Caltrain");
    expect(rejects(tools, "set_listing_status", { listingId: item!.id, status: "rejected", reason: "" })).toBe(true);
  });
});

describe("give_feedback and undo_feedback", () => {
  it("changes weights through applyFeedback, saves an event, reports moved listings, and undo restores", async () => {
    const before = await weightsOf();
    const out = await call(tools, "give_feedback", {
      reason: "the gym doesnt matter that much, i care more about cafes",
      changes: [
        { factor: "gym", direction: "down", size: "medium" },
        { factor: "cafes", direction: "up", size: "medium" },
      ],
    });
    expect(out.ok).toBe(true);
    expect(out.summary).toMatch(/^Gym weight 0\.\d\d to 0\.\d\d, cafes 0\.\d\d to 0\.\d\d\.$/);
    const after = await weightsOf();
    expect(after.gym).toBeLessThan(before.gym!);
    expect(after.cafes).toBeGreaterThan(before.cafes!);
    expect(Object.values(after).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (const f of SOFT_FACTORS) expect(Math.abs(after[f]! - before[f]!)).toBeLessThanOrEqual(MAX_CHANGE_PER_REACTION + 1e-9);
    expect(out.weightsBefore).toEqual(before);
    expect(out.weightsAfter).toEqual(after);
    expect((out.moved as unknown[]).length).toBeGreaterThan(0);
    expect(await getFeedbackEvents({}, opts())).toHaveLength(1);

    const undone = await call(tools, "undo_feedback", {});
    expect(undone.ok).toBe(true);
    const restored = await weightsOf();
    for (const f of SOFT_FACTORS) expect(restored[f]).toBeCloseTo(before[f]!, 12);
    expect((await call(tools, "undo_feedback", {})).ok).toBe(false);
  });

  it("caps a doubled change at 0.1 (the cap lives in the domain)", async () => {
    const before = await weightsOf();
    await call(tools, "give_feedback", {
      reason: "transit matters a lot",
      changes: [
        { factor: "transit_quality", direction: "up", size: "medium" },
        { factor: "transit_quality", direction: "up", size: "medium" },
      ],
    });
    const after = await weightsOf();
    expect(after.transit_quality! - before.transit_quality!).toBeLessThanOrEqual(MAX_CHANGE_PER_REACTION);
    expect(rejects(tools, "give_feedback", { reason: "x", changes: [{ factor: "pool", direction: "up", size: "small" }] })).toBe(true);
    expect(rejects(tools, "give_feedback", { reason: "x", changes: [{ factor: "gym", direction: "up", size: "huge" }] })).toBe(true);
  });
});

describe("draft_message", () => {
  it("asks the landlord the listing's open questions, as text only", async () => {
    const [item] = (await getBoard({ bucket: "needs_info" }, opts())).items;
    const detail = await getListing(item!.id, opts());
    const out = await call(tools, "draft_message", { listingId: item!.id, purpose: "ask_missing_facts" });
    expect(out.kind).toBe("draft");
    for (const q of detail!.filters!.questions.filter((q) => q.ask === "landlord")) expect(out.text).toContain(q.text);
    expect(Object.keys(out).sort()).toEqual(["kind", "ok", "purpose", "text", "to"]);
  });

  it("drafts a roommate intro and needs exactly one target", async () => {
    const [lead] = await getLeads(opts());
    const out = await call(tools, "draft_message", { leadId: lead!.id, purpose: "roommate_intro" });
    expect(out.ok).toBe(true);
    expect(out.text).toMatch(/video call/);
    expect(rejects(tools, "draft_message", { purpose: "roommate_intro" })).toBe(true);
    expect(rejects(tools, "draft_message", { listingId: 1, leadId: 1, purpose: "call_prep" })).toBe(true);
  });
});

describe("propose_settings_change", () => {
  it("proposes without writing; only the button action applies it, once", async () => {
    const before = (await getSettings(opts())).settings;
    const out = await call(tools, "propose_settings_change", { patch: { budgetCapCents: 240000 }, reason: "trim the budget" });
    expect(out.ok).toBe(true);
    expect(out.changes).toEqual([{ key: "budgetCapCents", label: "Budget cap", from: fmtCents(before.budgetCapCents), to: "$2,400.00" }]);
    expect((await getSettings(opts())).settings).toEqual(before);

    const messageId = await saveChatMessage(
      { role: "assistant", content: { text: "", tools: [{ toolCallId: "c1", toolName: "propose_settings_change", input: {}, output: out }], provider: "test", notice: null } },
      opts(),
    );
    const applied = await applySettingsProposal({ messageId, toolCallId: "c1" }, opts());
    expect(applied.ok).toBe(true);
    expect((await getSettings(opts())).settings.budgetCapCents).toBe(240000);
    expect(await applySettingsProposal({ messageId, toolCallId: "c1" }, opts())).toEqual({ ok: false, error: "already applied" });
  });

  it("cannot propose the office address, a bad value, or a change to nothing", async () => {
    expect(rejects(tools, "propose_settings_change", { patch: { officeAddress: "1 Other St" }, reason: "x" })).toBe(true);
    expect(rejects(tools, "propose_settings_change", { patch: { budgetCapCents: -5 }, reason: "x" })).toBe(true);
    const current = (await getSettings(opts())).settings.budgetCapCents;
    const out = await call(tools, "propose_settings_change", { patch: { budgetCapCents: current }, reason: "same" });
    expect(out).toEqual({ ok: false, error: "nothing would change" });
  });
});

describe("roommate leads", () => {
  it("lists leads and moves one along", async () => {
    const leads = await getLeads(opts());
    const out = await call(tools, "list_roommate_leads", {});
    expect((out.leads as unknown[]).length).toBe(leads.length);
    const id = leads[0]!.id;
    const moved = await call(tools, "update_roommate_lead_status", { leadId: id, status: "messaged", notes: "sent an intro" });
    expect(moved).toEqual({ ok: true, id, status: "messaged" });
    expect((await getLeads(opts())).find((l) => l.id === id)?.notes).toBe("sent an intro");
    expect(rejects(tools, "update_roommate_lead_status", { leadId: id, status: "paid" })).toBe(true);
  });
});

