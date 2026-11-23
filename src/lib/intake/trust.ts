// Stage: trust. Rule-based scam checks from docs/requirements.md "Reviews, trust and scam
// protection". Pure code over the post text and my own saved listings. Each check is Pass, Fail
// or Unknown, never a guess:
//
//   - Fail: the red flag is in the text, or the price is far below my saved listings.
//   - Pass: the text is long enough to judge and the red flag is absent. For a text check this
//     only says "nothing suspicious in what was written". It is not proof about the person.
//   - Unknown: not enough to judge, or the check needs a human (live video tour, owner on
//     record, address against Street View).
//
// The result is stored as the `scamChecks` fact with provenance `estimate`, so a check I resolve
// by hand (provenance `me`) always wins over it.

import { SCAM_CHECK_IDS, type ScamCheckId, type ScamChecks } from "@/lib/domain";
import type { ScamCheckDetail } from "./types";

/** A post shorter than this is a title or a snippet: too little to call a red flag absent. */
export const MIN_TEXT_FOR_PASS = 250;
/** Price is "far below" my saved listings under this share of their median. */
export const FAR_BELOW_RATIO = 0.6;
/** Fewer saved listings of the same type than this gives no baseline. */
export const MIN_BASELINE = 3;

export type SavedPrice = { id: number; type: string | null; rentCents: number | null };

export type TrustInput = {
  text: string;
  type: string | null;
  rentCents: number | null;
  /** Another listing with the same photo but a different address, if the dedupe stage found one. */
  photoReusedFrom: number | null;
  saved: SavedPrice[];
  /** The listing being checked, so it is not compared with itself. */
  selfId?: number | null;
};

const ALWAYS_SUSPICIOUS = /\b(gift ?cards?|bitcoin|btc|crypto(?:currency)?|western union|money ?gram|itunes card|steam card)\b/i;
const SOMETIMES_SUSPICIOUS = /\b(wire(?: transfer)?|zelle|cash ?app|venmo|apple pay)\b/i;
const BEFORE_LEASE = /\b(before|prior to|ahead of|up ?front|in advance|to (?:hold|reserve|secure|lock)|first(?!\s+(?:of|day|month|week))|without (?:a )?(?:lease|viewing|tour))\b/i;
const OVERSEAS = [
  /\boverseas\b/i,
  /\babroad\b/i,
  /\bout of (?:the )?(?:country|state)\b/i,
  /\b(?:mail|ship|send|courier)\w*\s+(?:you\s+)?(?:the\s+)?keys?\b/i,
  /\bkeys?\s+(?:will be|are|is|can be)\s+(?:mailed|shipped|sent|couriered)\b/i,
  /\b(?:missionary|on a mission|deployed)\b/i,
];
const PRESSURE =
  /\b(first (?:to|one to) (?:send|pay|deposit)|first come,? first served|pay (?:today|now|asap|immediately)|(?:deposit|payment)\s+(?:today|now|asap|immediately|within \d+\s*(?:hours?|hrs?))|(?:must|need to|have to|has to)\s+(?:pay|send|put down)\s+(?:a\s+)?(?:\w+\s+){0,2}(?:today|now|immediately|asap)|won'?t last|act (?:now|fast|quickly)|many (?:other )?people (?:are )?interested)\b/i;
const NO_TOUR =
  /\b(?:no|not|can'?t|cannot|unable to|won'?t|will not|refuse to)\b[^.\n]{0,30}\b(?:video|virtual|zoom|facetime|live)\s*(?:tour|call|showing|walk[- ]?through|viewing)/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?\n])\s+/);
}

export function untraceablePayment(text: string): string | null {
  for (const sentence of sentences(text)) {
    const strong = ALWAYS_SUSPICIOUS.exec(sentence);
    if (strong) return `Mentions ${strong[1]?.toLowerCase()} as a way to pay`;
    const weak = SOMETIMES_SUSPICIOUS.exec(sentence);
    if (weak && BEFORE_LEASE.test(sentence)) {
      return `Asks for ${weak[1]?.toLowerCase()} before a signed lease`;
    }
  }
  return null;
}

export function overseasLandlord(text: string): string | null {
  const hit = OVERSEAS.find((pattern) => pattern.test(text));
  return hit ? "Says the owner is away or keys will be mailed" : null;
}

export function pressureToPay(text: string): string | null {
  const match = PRESSURE.exec(text);
  return match ? `Pressure to pay fast ("${match[0].toLowerCase()}")` : null;
}

export function refusesVideoTour(text: string): string | null {
  return NO_TOUR.test(text) ? "Says there will be no live video tour" : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export type PriceCheck = { status: "pass" | "fail" | null; reason: string; medianCents: number | null };

/** Price against the median of my own saved listings of the same type. */
export function priceAgainstSaved(input: Pick<TrustInput, "type" | "rentCents" | "saved" | "selfId">): PriceCheck {
  if (input.rentCents === null || input.type === null) {
    return { status: null, reason: "Rent or type is Unknown, so no price comparison", medianCents: null };
  }
  const peers = input.saved
    .filter((s) => s.id !== input.selfId && s.type === input.type && s.rentCents !== null)
    .map((s) => s.rentCents as number);
  if (peers.length < MIN_BASELINE) {
    return {
      status: null,
      reason: `Only ${peers.length} saved ${input.type} listings to compare with, need ${MIN_BASELINE}`,
      medianCents: null,
    };
  }
  const mid = median(peers) as number;
  const ratio = input.rentCents / mid;
  return ratio < FAR_BELOW_RATIO
    ? { status: "fail", reason: `Rent is ${Math.round(ratio * 100)}% of the median of ${peers.length} saved ${input.type} listings`, medianCents: mid }
    : { status: "pass", reason: `Rent is ${Math.round(ratio * 100)}% of the median of ${peers.length} saved ${input.type} listings`, medianCents: mid };
}

export type TrustResult = { checks: ScamChecks; details: ScamCheckDetail[]; medianCents: number | null };

export function runTrustChecks(input: TrustInput): TrustResult {
  const judgeable = input.text.trim().length >= MIN_TEXT_FOR_PASS;
  const details: ScamCheckDetail[] = [];
  const set = (id: ScamCheckId, status: "pass" | "fail" | null, reason: string) =>
    details.push({ id, status, reason });

  const textCheck = (id: ScamCheckId, hit: string | null, clean: string) => {
    if (hit) set(id, "fail", hit);
    else if (judgeable) set(id, "pass", clean);
    else set(id, null, "Post text is too short to judge");
  };

  const price = priceAgainstSaved(input);
  set("price_far_below_market", price.status, price.reason);

  const tour = refusesVideoTour(input.text);
  set("no_live_video_tour", tour ? "fail" : null, tour ?? "Ask the landlord for a live video tour");

  textCheck(
    "untraceable_payment_before_lease",
    untraceablePayment(input.text),
    "No wire, Zelle, gift card or crypto request in the post",
  );
  textCheck("overseas_landlord", overseasLandlord(input.text), "Nothing about an absent owner or mailed keys");
  set(
    "photos_reused",
    input.photoReusedFrom === null ? null : "fail",
    input.photoReusedFrom === null
      ? "Run a Google Lens check on the photos"
      : `A photo matches saved listing ${input.photoReusedFrom}, which has a different address`,
  );
  textCheck("pressure_to_pay_fast", pressureToPay(input.text), "No pressure to pay fast in the post");
  set("not_owner_or_address_mismatch", null, "Needs a check of the owner on record and the address");

  const checks = Object.fromEntries(SCAM_CHECK_IDS.map((id) => [id, null])) as ScamChecks;
  for (const detail of details) checks[detail.id as ScamCheckId] = detail.status;
  return { checks, details, medianCents: price.medianCents };
}
