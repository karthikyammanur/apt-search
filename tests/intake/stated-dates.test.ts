import { describe, expect, it } from "vitest";
import { postedDate, statedDates, toDraft } from "@/lib/intake/schema";
import { extraction } from "./helpers";

const REF = "2026-11-24";

describe("statedDates: ranges and open ends written in the post", () => {
  it.each([
    { text: "Dec 12 to Jan 9", from: "2026-12-12", end: "2027-01-09" },
    { text: "12/15-12/22", from: "2026-12-15", end: "2026-12-22" },
    { text: "Jan 1 - Aug 31", from: "2027-01-01", end: "2027-08-31" },
    { text: "from 12th December until 9th January", from: "2026-12-12", end: "2027-01-09" },
    { text: "Furnished room Dec 15–22, near campus", from: "2026-12-15", end: "2026-12-22" },
    { text: "Studio Dec 6th - Jan 1", from: "2026-12-06", end: "2027-01-01" },
    { text: "Dec 28-3", from: "2026-12-28", end: "2027-01-03" },
    { text: "Jan 4, 2027 through Aug 10, 2027", from: "2027-01-04", end: "2027-08-10" },
    { text: "1/2/27 to 8/13/27", from: "2027-01-02", end: "2027-08-13" },
    { text: "Sublet Jan - Aug", from: "2027-01-01", end: "2027-08-31" },
    { text: "available Nov 30 to Dec 5", from: "2026-11-30", end: "2026-12-05" },
  ])("$text gives $from to $end", ({ text, from, end }) => {
    expect(statedDates(text, REF)).toEqual({ availableFrom: from, leaseEnd: end, openEnded: false });
  });

  it.each([
    { text: "Room with a private bathroom until December", end: "2026-12-31" },
    { text: "room till Jan 9", end: "2027-01-09" },
    { text: "available through May", end: "2027-05-31" },
    { text: "until November", end: "2026-11-30" },
  ])("$text is an open end on $end", ({ text, end }) => {
    expect(statedDates(text, REF)).toEqual({ availableFrom: null, leaseEnd: end, openEnded: true });
  });

  it.each([
    "Long-term EVGR D Junior 2B2B sublease for 1 bedroom starting from Feb or March",
    "1B1B studio next to Stanford, 1m to EV, avaliable after Dec.",
    "Room in 2B1B Apartment, $1560, decent market nearby",
    "Price: $1800\nPosted: 2026-11-24T02:38:23.957+00:00",
    "Feb 30 to Mar 3",
    "Jan 9 to Jan 2",
  ])("states no range: %s", (text) => {
    expect(statedDates(text, REF)).toEqual({ availableFrom: null, leaseEnd: null, openEnded: false });
  });

  it("counts the year from the reference date: December in December is this year, in January next", () => {
    expect(statedDates("until December", "2026-12-10").leaseEnd).toBe("2026-12-31");
    expect(statedDates("until December", "2027-01-10").leaseEnd).toBe("2027-12-31");
  });

  it("reads the post date SUPost puts in the text", () => {
    expect(postedDate("Title\nPrice: $1\nPosted: 2026-11-22T22:54:55.431+00:00")).toBe("2026-11-22");
    expect(postedDate("no date here")).toBeNull();
  });
});

describe("toDraft fills dates and lease type from the text", () => {
  it("fills gaps but never overrides dates the model read", () => {
    const draft = toDraft(
      extraction({ post_type: "room_offered", available_from: "2027-01-03", lease_end: "2027-08-20" }),
      "Room Jan 1 - Aug 31",
      { today: REF },
    );
    expect(draft.facts).toMatchObject({ availableFrom: "2027-01-03", leaseEnd: "2027-08-20", leaseType: "fixed" });
  });

  it("types a dated range as a sublet when the post says sublet", () => {
    const draft = toDraft(extraction({ post_type: "room_offered" }), "Sublet Dec 12 to Jan 9", { today: REF });
    expect(draft.facts).toMatchObject({ leaseType: "sublet", availableFrom: "2026-12-12", leaseEnd: "2027-01-09" });
  });

  it("an open end changes a fixed lease to a sublet, unless the post talks about a lease", () => {
    const sublet = toDraft(extraction({ post_type: "room_offered", lease_type: "fixed" }), "Room until December", { today: REF });
    expect(sublet.facts).toMatchObject({ leaseType: "sublet", leaseEnd: "2026-12-31" });
    expect(sublet.issues.join(" ")).toContain("changed to sublet");

    const lease = toDraft(extraction({ post_type: "room_offered", lease_type: "fixed" }), "6-month lease until June", { today: REF });
    expect(lease.facts).toMatchObject({ leaseType: "fixed", leaseEnd: "2027-06-30" });

    const monthly = toDraft(extraction({ post_type: "room_offered", lease_type: "month_to_month" }), "Month to month until May", { today: REF });
    expect(monthly.facts.leaseType).toBe("month_to_month");
  });

  it("leaves roommate-wanted posts alone", () => {
    const draft = toDraft(extraction({ post_type: "roommate_wanted" }), "Looking for a roommate Jan 1 - Aug 31", { today: REF });
    expect(draft.facts).toEqual({});
  });
});
