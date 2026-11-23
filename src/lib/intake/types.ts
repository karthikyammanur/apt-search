// Shared shapes for the intake pipeline. Money is integer cents, durations are integer minutes,
// dates are ISO strings. Unknown is a missing key or null, never 0.

import type { CHANNELS, POST_TYPES } from "@/db/schema";
import type { LlmImage } from "@/lib/llm";
import type { Bucket, ListingFactValues } from "@/lib/domain";

export type PostType = (typeof POST_TYPES)[number];
export type ChannelName = (typeof CHANNELS)[number];
/** "paste" is the chat fallback. It is not a channel and writes no channel_runs row. */
export type IntakeChannel = ChannelName | "paste";

/** What a channel's own structured data states. These win over anything the model reads. */
export type Prefill = {
  postType?: PostType;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  facts?: Partial<ListingFactValues>;
};

/** What every channel adapter yields. */
export type RawListing = {
  channel: IntakeChannel;
  /** Where it was seen: supost, craigslist, zillow, hotpads, facebook_group, rentcast, a site host. */
  source: string;
  /** The listing's own link. Kept as data. The server never opens it. */
  url: string | null;
  title?: string | null;
  text: string;
  photoUrls: string[];
  /** Perceptual hashes supplied by the extension, in the same order as needed for matching. */
  photoHashes: string[];
  groupName?: string | null;
  posterName?: string | null;
  posterProfileUrl?: string | null;
  /** Screenshots from the chat, as data: URLs or bytes. Never remote URLs. */
  images?: LlmImage[];
  prefill?: Prefill;
  /** Structured API data only: skip the model. */
  skipModel?: boolean;
  /** Free-form channel metadata, such as the sender of an email. Kept for debugging, never trusted. */
  meta?: Record<string, string | number | null>;
};

export type RoommateInfo = {
  datesWanted: string | null;
  budgetCents: number | null;
};

/** The model's reading of a post, after money is converted to cents. Only known values are present. */
export type Draft = {
  postType: PostType;
  address: string | null;
  lat: number | null;
  lng: number | null;
  facts: Partial<ListingFactValues>;
  roommate: RoommateInfo | null;
  /** Things validation dropped or changed, for the run summary. */
  issues: string[];
};

export type ScamCheckDetail = {
  id: string;
  status: "pass" | "fail" | null;
  reason: string;
};

export type IntakeStatus =
  | "stored"
  | "merged"
  | "already_seen"
  | "roommate_lead"
  | "skipped"
  | "error";

/** One line per processed post, for the run summary. */
export type IntakeOutcome = {
  status: IntakeStatus;
  source: string;
  url: string | null;
  listingId: number | null;
  type: string | null;
  /** "pass" | "fail" | "needs_info" | "likely", or null when the post never became a listing. */
  bucket: Bucket | null;
  allInMonthlyCents: number | null;
  commuteMinutes: number | null;
  score: number | null;
  /** Why the post was skipped, failed early or errored. */
  note: string | null;
};
