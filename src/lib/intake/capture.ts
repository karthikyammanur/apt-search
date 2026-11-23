// The extension capture endpoint's logic, kept apart from the Next route so tests can call it.
//
// Two shapes are accepted, and nothing else:
//   - one page:            { url, title?, text, photoUrls? }
//   - Facebook post batch: { posts: [{ postUrl, groupName, posterName, posterProfileUrl, text,
//                                      photoUrls, photoHash? }], groupName? }
//
// The caller must send header X-Capture-Token equal to CAPTURE_TOKEN. With no token configured
// every request is refused. Nothing in the payload is ever opened: urls are stored as data.

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ChannelName, IntakeOutcome, RawListing } from "./types";
import { processRaw, type IntakeDeps } from "./pipeline";
import { recordChannelRun } from "./store";

export const CAPTURE_TOKEN_HEADER = "x-capture-token";
export const MAX_BODY_CHARS = 2_000_000;
const MIN_TOKEN_LENGTH = 16;

const webUrl = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "must be an http or https URL");

const photos = z.array(webUrl).max(30).default([]);
const label = z.string().trim().max(300).nullish();

export const pageSchema = z
  .object({
    url: webUrl,
    title: z.string().max(500).optional(),
    text: z.string().trim().min(1).max(30_000),
    photoUrls: photos,
  })
  .strict();

export const postSchema = z
  .object({
    postUrl: webUrl,
    groupName: label,
    posterName: label,
    posterProfileUrl: webUrl.nullish(),
    text: z.string().trim().min(1).max(20_000),
    photoUrls: photos,
    photoHash: z.string().max(200).nullish(),
  })
  .strict();

export const batchSchema = z
  .object({ posts: z.array(postSchema).min(1).max(50), groupName: label })
  .strict();

export const captureSchema = z.union([batchSchema, pageSchema]);
export type CapturePayload = z.infer<typeof captureSchema>;

/** Constant-time check of the presented token against the configured one. */
export function tokenMatches(presented: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_TOKEN_LENGTH || !presented) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

function hostLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
}

export function captureToRaw(payload: CapturePayload): RawListing[] {
  if ("posts" in payload) {
    return payload.posts.map((post) => ({
      channel: "facebook_capture" as const,
      source: "facebook_group",
      url: post.postUrl,
      title: null,
      text: post.text,
      photoUrls: post.photoUrls,
      photoHashes: post.photoHash ? [post.photoHash] : [],
      groupName: post.groupName ?? payload.groupName ?? null,
      posterName: post.posterName ?? null,
      posterProfileUrl: post.posterProfileUrl ?? null,
    }));
  }
  return [
    {
      channel: "extension" as const,
      source: hostLabel(payload.url),
      url: payload.url,
      title: payload.title ?? null,
      text: payload.text,
      photoUrls: payload.photoUrls,
      photoHashes: [],
    },
  ];
}

export type CaptureResponse = { status: number; body: Record<string, unknown> };

export async function handleCapture(
  request: { token: string | null; expectedToken: string | undefined; body: unknown },
  deps: () => Promise<IntakeDeps>,
): Promise<CaptureResponse> {
  if (!tokenMatches(request.token, request.expectedToken)) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  const parsed = captureSchema.safeParse(request.body);
  if (!parsed.success) {
    return { status: 400, body: { error: "invalid payload", fields: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) } };
  }
  const items = captureToRaw(parsed.data);
  const ready = await deps();
  const outcomes: IntakeOutcome[] = [];
  for (const raw of items) outcomes.push(await processRaw(ready, raw));

  // One channel_runs row per group for Facebook batches, so "last captured" is per group.
  const channel: ChannelName = "posts" in parsed.data ? "facebook_capture" : "extension";
  const groups = new Map<string | null, IntakeOutcome[]>();
  for (const [index, outcome] of outcomes.entries()) {
    const group = items[index]?.groupName ?? null;
    groups.set(group, [...(groups.get(group) ?? []), outcome]);
  }
  const now = ready.now().toISOString();
  for (const [group, list] of groups) {
    await recordChannelRun(
      ready.db,
      {
        channel,
        groupName: group,
        itemsSeen: list.length,
        itemsNew: list.filter((o) => o.status === "stored" || o.status === "roommate_lead").length,
        error: list.some((o) => o.status === "error") ? "some posts failed" : null,
      },
      now,
    );
  }
  return {
    status: 200,
    body: {
      ok: true,
      results: outcomes.map((o) => ({
        status: o.status,
        listingId: o.listingId,
        bucket: o.bucket,
        allInMonthlyCents: o.allInMonthlyCents,
        commuteMinutes: o.commuteMinutes,
        note: o.note,
      })),
    },
  };
}
