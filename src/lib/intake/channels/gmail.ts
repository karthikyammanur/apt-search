// Gmail channel: new messages under the housing-alerts label, through the read-only Gmail
// provider. Only the message body is parsed (see email.ts). No link inside an email is opened.

import type { createGmail } from "@/lib/providers";
import type { RawListing } from "../types";
import { parseEmail } from "./email";
import type { Collected } from "./types";

type GmailClient = Pick<ReturnType<typeof createGmail>, "listMessages" | "getMessage">;

export const MAX_PAGES = 3;
export const MAX_MESSAGES = 60;

export async function collectGmail(
  client: GmailClient,
  since: string,
  limits: { maxMessages?: number } = {},
): Promise<Collected> {
  const maxMessages = limits.maxMessages ?? MAX_MESSAGES;
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES && ids.length < maxMessages; page += 1) {
    const listed = await client.listMessages(since, pageToken);
    if (!listed.ok) {
      return listed.error === "disabled"
        ? { items: [], error: null, skipped: "Gmail is disabled (no credentials)" }
        : { items: [], error: `list: ${listed.error}` };
    }
    ids.push(...(listed.data.messages ?? []).map((m) => m.id));
    pageToken = listed.data.nextPageToken;
    if (!pageToken) break;
  }

  const items: RawListing[] = [];
  const warnings: string[] = [];
  let unrecognized = 0;
  for (const id of ids.slice(0, maxMessages)) {
    const message = await client.getMessage(id);
    if (!message.ok) {
      warnings.push(`message ${id}: ${message.error}`);
      continue;
    }
    const parsed = parseEmail(message.data);
    if (parsed.sender === null) unrecognized += 1;
    items.push(...parsed.listings);
  }
  if (unrecognized > 0) warnings.push(`${unrecognized} message(s) from a sender that is not recognized`);
  // Every message failing to read is a channel failure; a few failing is a warning.
  const error = ids.length > 0 && warnings.filter((w) => w.startsWith("message ")).length === ids.length ? "no message could be read" : null;
  return { items, error, warnings };
}
