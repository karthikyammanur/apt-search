import { tool } from "ai";
import { z } from "zod";
import { getListing, type ListingDetail } from "@/lib/queries";
import { untrusted } from "../prompt";
import { fail, minutes, money, type ToolContext } from "./context";

export const listingIdInput = z.object({ listingId: z.number().int().positive() });

/** A compact view of one listing for the model. Every value is the stored one. */
export function listingSummary(d: ListingDetail) {
  const facts = Object.fromEntries(
    Object.values(d.facts)
      .filter((f) => !["commuteRoute", "nearbyStops", "scamChecks", "reviews"].includes(f.field))
      .map((f) => [f.field, f.current ? { value: f.current.value, from: f.current.provenance, note: f.current.note } : "Unknown"]),
  );
  return {
    id: d.listing.id,
    title: d.listing.title,
    city: d.listing.city,
    type: d.listing.type,
    source: d.listing.source,
    url: d.listing.url,
    bucket: d.bucket,
    score: d.score,
    userStatus: d.listing.userStatus,
    userStatusReason: d.listing.userStatusReason,
    allInMonthly: money(d.allInMonthlyCents),
    allInPlusTransit: money(d.allInPlusTransitCents),
    upfrontCash: money(d.cost?.upfrontCashCents ?? null),
    costLines: d.cost?.lines ?? [],
    commute: minutes(d.commute.transitMinutes),
    bikeCommute: minutes(d.commute.bikeMinutes),
    commuteLegs: d.commute.legs,
    nearestStop: d.transit.nearestStop ?? "Unknown",
    stopWalk: minutes(d.transit.stopWalkMinutes),
    rushHeadway: minutes(d.transit.rushHeadwayMinutes),
    filters: d.filters?.results ?? [],
    openQuestions: d.filters?.questions ?? [],
    likelyReason: d.filters?.likelyReason ?? null,
    scamChecks: d.trust,
    roommates: d.roommates,
    facts,
    postText: d.listing.rawText ? untrusted(d.listing.rawText.slice(0, 1500)) : null,
  };
}

export function getListingTool(ctx: ToolContext) {
  return tool({
    description: "Full detail for one listing: cost lines with sources, filters with reasons, open questions, commute, transit, scam checks, roommates and facts with provenance.",
    inputSchema: listingIdInput,
    execute: async ({ listingId }) => {
      const detail = await getListing(listingId, ctx.options);
      return detail ? { ok: true as const, listing: listingSummary(detail) } : fail("no such listing");
    },
  });
}
