import { describe, expect, it } from "vitest";
import {
  FAR_BELOW_RATIO,
  MIN_TEXT_FOR_PASS,
  median,
  overseasLandlord,
  pressureToPay,
  priceAgainstSaved,
  refusesVideoTour,
  runTrustChecks,
  untraceablePayment,
  type SavedPrice,
} from "@/lib/intake/trust";

const LONG = "A quiet furnished room in a shared house close to the train. ".repeat(6);
const saved = (rents: number[], type = "room"): SavedPrice[] =>
  rents.map((rentCents, i) => ({ id: i + 1, type, rentCents }));

describe("red flags in the text", () => {
  it.each([
    { text: "Please send a gift card to hold the room.", fail: true },
    { text: "I only accept bitcoin.", fail: true },
    { text: "Pay the deposit with Western Union.", fail: true },
    { text: "Send a Zelle payment before we sign the lease.", fail: true },
    { text: "Wire the deposit first and I will mail the keys.", fail: true },
    { text: "Rent is paid by Zelle on the first of the month.", fail: false },
    { text: "Venmo is fine for splitting the internet after you move in.", fail: false },
    { text: "Cash or check, signed lease required.", fail: false },
  ])("payment: '$text' fails: $fail", ({ text, fail }) => {
    expect(untraceablePayment(text) !== null).toBe(fail);
  });

  it.each([
    { text: "I'm currently overseas but my agent will mail you the keys.", fail: true },
    { text: "We are out of the country right now.", fail: true },
    { text: "Keys will be shipped after payment.", fail: true },
    { text: "The landlord lives on site and does tours.", fail: false },
  ])("overseas: '$text' fails: $fail", ({ text, fail }) => {
    expect(overseasLandlord(text) !== null).toBe(fail);
  });

  it.each([
    { text: "First to send a deposit gets the room.", fail: true },
    { text: "You must pay today or it is gone.", fail: true },
    { text: "Act now, this won't last.", fail: true },
    { text: "Deposit within 24 hours to hold it.", fail: true },
    { text: "Deposit is due at signing.", fail: false },
  ])("pressure: '$text' fails: $fail", ({ text, fail }) => {
    expect(pressureToPay(text) !== null).toBe(fail);
  });

  it.each([
    { text: "Sorry, no video tour available.", fail: true },
    { text: "I can't do a live video call, only photos.", fail: true },
    { text: "Video tour available on request.", fail: false },
  ])("tour: '$text' fails: $fail", ({ text, fail }) => {
    expect(refusesVideoTour(text) !== null).toBe(fail);
  });
});

describe("price against my own saved listings", () => {
  const check = (rentCents: number | null, peers: SavedPrice[], type: string | null = "room") =>
    priceAgainstSaved({ type, rentCents, saved: peers });

  it("fails far below the median, passes at the line, and the line is 60%", () => {
    const peers = saved([200000, 200000, 200000]);
    expect(FAR_BELOW_RATIO).toBe(0.6);
    expect(check(119999, peers).status).toBe("fail");
    expect(check(120000, peers).status).toBe("pass");
    expect(check(150000, peers).status).toBe("pass");
  });

  it("is Unknown without a baseline of 3 listings of the same type", () => {
    expect(check(50000, saved([200000, 200000])).status).toBeNull();
    expect(check(50000, saved([200000, 200000, 200000], "studio")).status).toBeNull();
    expect(check(null, saved([200000, 200000, 200000])).status).toBeNull();
    expect(check(50000, saved([200000, 200000, 200000]), null).status).toBeNull();
  });

  it("does not compare a listing with itself", () => {
    const peers = saved([200000, 200000, 50000]);
    expect(priceAgainstSaved({ type: "room", rentCents: 50000, saved: peers, selfId: 3 }).status).toBeNull();
  });

  it("median of an even and odd list", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("runTrustChecks", () => {
  const input = (over: Partial<Parameters<typeof runTrustChecks>[0]> = {}) => ({
    text: LONG,
    type: "room",
    rentCents: 200000,
    photoReusedFrom: null,
    saved: [] as SavedPrice[],
    ...over,
  });

  it("each check is pass, fail or Unknown, and a clean long post passes only the text checks", () => {
    const { checks } = runTrustChecks(input());
    expect(checks).toEqual({
      price_far_below_market: null,
      no_live_video_tour: null,
      untraceable_payment_before_lease: "pass",
      overseas_landlord: "pass",
      photos_reused: null,
      pressure_to_pay_fast: "pass",
      not_owner_or_address_mismatch: null,
    });
  });

  it("a short snippet is Unknown, not Pass", () => {
    expect(LONG.length).toBeGreaterThan(MIN_TEXT_FOR_PASS);
    const { checks } = runTrustChecks(input({ text: "Room $1,700" }));
    expect(checks.untraceable_payment_before_lease).toBeNull();
    expect(checks.overseas_landlord).toBeNull();
  });

  it("a hit fails even in a short snippet", () => {
    const { checks, details } = runTrustChecks(input({ text: "Send a gift card now" }));
    expect(checks.untraceable_payment_before_lease).toBe("fail");
    expect(details.find((d) => d.id === "untraceable_payment_before_lease")?.reason).toContain("gift card");
  });

  it("a reused photo and a far-below price both fail", () => {
    const result = runTrustChecks(input({ rentCents: 90000, saved: saved([200000, 210000, 190000]), photoReusedFrom: 7 }));
    expect(result.checks.photos_reused).toBe("fail");
    expect(result.checks.price_far_below_market).toBe("fail");
    expect(result.medianCents).toBe(200000);
  });
});
