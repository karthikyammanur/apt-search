// Who routed a commute is written next to it, so the commute filter can treat a free provider's
// answer near the limit as Unknown. Checked from enrichment, through the database, to the filter.

import { describe, expect, it } from "vitest";
import { listings } from "@/db/schema";
import { checkCommute } from "@/lib/domain";
import { enrichListing } from "@/lib/intake/enrich";
import { loadFacts, type FactWrite } from "@/lib/intake/facts";
import { runAutomaticChannels } from "@/lib/intake/run";
import { FIXTURE_REPLIES, HOME, OFFICE, makeDeps, stubGeo } from "./helpers";

const STEPS = [{ mode: "TRANSIT", lineName: "21", minutes: 12 }];

function geoVia(provider: string | undefined, minutes: number) {
  const { geo } = stubGeo();
  return { ...geo, transit: async () => ({ ok: true as const, data: { minutes, steps: STEPS, provider } }) };
}

const input = { ...HOME, office: OFFICE, startDate: "2027-01-11", stops: [] };
const commuteFact = (facts: FactWrite[]) => facts.find((f) => f.field === "commuteMinutes")!;

describe("enrichment records who routed the commute", () => {
  it("writes a note naming the provider", async () => {
    expect(commuteFact((await enrichListing(geoVia("transitland", 28), input)).facts)).toMatchObject({
      value: 28,
      provenance: "api",
      note: "Routed by Transitland",
    });
    expect(commuteFact((await enrichListing(geoVia("google", 28), input)).facts).note).toBe("Routed by Google");
  });

  it("writes no note when the provider is not known", async () => {
    expect(commuteFact((await enrichListing(geoVia(undefined, 28), input)).facts).note).toBeNull();
  });
});

describe("from the pipeline to the filter", () => {
  const item = {
    id: "rc-margin",
    formattedAddress: "55 Test Way, Menlo Park, CA 94025",
    latitude: HOME.lat,
    longitude: HOME.lng,
    price: 2300,
    propertyType: "Apartment",
    bedrooms: 0,
    bathrooms: 1,
    city: "Menlo Park",
  };

  async function commuteFilterFor(provider: string, minutes: number) {
    const { deps, db } = await makeDeps(FIXTURE_REPLIES);
    deps.geo = geoVia(provider, minutes);
    await runAutomaticChannels(deps, {
      channels: ["rentcast"],
      clients: { rentcast: { listings: async () => ({ ok: true as const, data: [item] }) } },
    });
    const [row] = await db.select().from(listings);
    const facts = await loadFacts(db, row!.id);
    return { facts, result: checkCommute(facts, deps.settings) };
  }

  it("a free provider's 28 minutes is stored with its note and filters as Unknown", async () => {
    const { facts, result } = await commuteFilterFor("transitland", 28);
    expect(facts.commuteMinutes).toMatchObject({ value: 28, provenance: "api", note: "Routed by Transitland" });
    expect(result).toMatchObject({ status: "unknown", reason: "Commute close to the limit, check it on Google Maps" });
  });

  it("the same 28 minutes from Google passes", async () => {
    expect((await commuteFilterFor("google", 28)).result.status).toBe("pass");
  });

  it("a free provider's 20 minutes passes and its 40 minutes fails, outside the margin", async () => {
    expect((await commuteFilterFor("transitland", 20)).result.status).toBe("pass");
    expect((await commuteFilterFor("transitland", 40)).result.status).toBe("fail");
  });
});
