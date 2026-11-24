// Parse housing alert emails into raw listings. Pure text work on the message body: this module
// has no network access of any kind. Links and image links found in the body are kept as data
// (a listing's url, its photo urls) and are never opened (golden rule 4).
//
// Senders recognized: Craigslist, Zillow, HotPads and Facebook group notifications. One email
// can hold several listings (a Craigslist or Zillow digest); a Facebook email holds one post.
//
// The splitting is a heuristic over the email layout: every listing link starts a block, and the
// block begins at the nearest blank line above its link. It is tested on saved samples
// (tests/fixtures/intake/) and must be rechecked when a site changes its email format.

import type { RawListing } from "../types";

export type Sender = "craigslist" | "zillow" | "hotpads" | "facebook_group";

export type EmailInput = {
  id: string;
  headers: { name: string; value: string }[];
  plainText: string | null;
  html: string | null;
};

const SENDER_DOMAINS: [string, Sender][] = [
  ["craigslist.org", "craigslist"],
  ["zillow.com", "zillow"],
  ["zillowgroup.com", "zillow"],
  ["hotpads.com", "hotpads"],
  ["facebookmail.com", "facebook_group"],
  ["facebook.com", "facebook_group"],
];

export function senderOf(from: string): Sender | null {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const domain = address.split("@")[1]?.trim().toLowerCase();
  if (!domain) return null;
  return SENDER_DOMAINS.find(([suffix]) => domain === suffix || domain.endsWith(`.${suffix}`))?.[1] ?? null;
}

const LISTING_LINK: Record<Sender, RegExp> = {
  craigslist: /craigslist\.org\/(?:[a-z]{3}\/)?[a-z]{3}\/d\/|craigslist\.org\/.*\/\d{9,}\.html/i,
  zillow: /zillow\.com\/(?:homedetails|b|apartments|community|rental)\b|_zpid/i,
  hotpads: /hotpads\.com\/.+\/(?:pad|building|listing)\b|hotpads\.com\/.*-pad\b|\/pad\//i,
  facebook_group: /permalink|\/posts\/|story_fbid|\/groups\/[^/]+\/\d/i,
};

const FOOTER =
  /\bunsubscribe\b|^you(?:'|’)?re receiving|^you received this|^manage (?:your )?(?:alerts?|settings|notifications?|email)|^view (?:this )?(?:email )?in (?:your )?browser|^©|^privacy policy|^terms of use/i;
const PIXEL = /pixel|spacer|beacon|\/open\.|\/track|1x1/i;

const LINK_MARK = (n: number) => `⟦L${n}⟧`;
const IMG_MARK = (n: number) => `⟦I${n}⟧`;
const MARK_RE = /⟦([LI])(\d+)⟧/g;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&apos;|&#39;/gi, "'");
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? "") : null;
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/** Drop tracking noise from a listing link. Facebook links keep their query: the post id lives in it. */
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (/facebook\.com$/i.test(parsed.hostname)) {
      parsed.hash = "";
      return parsed.toString();
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

type Marked = { lines: string[]; links: string[]; images: string[] };

/** HTML to lines of text, with each link and image replaced by a numbered marker. */
export function htmlToMarked(html: string): Marked {
  const links: string[] = [];
  const images: string[] = [];
  let body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, "");
  body = body.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attr(tag, "src");
    const width = Number(attr(tag, "width") ?? "NaN");
    const height = Number(attr(tag, "height") ?? "NaN");
    if (!src || !isWebUrl(src) || PIXEL.test(src) || width <= 60 || height <= 60) return " ";
    images.push(src);
    return ` ${IMG_MARK(images.length - 1)} `;
  });
  body = body.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs: string, inner: string) => {
    const href = attr(`<a ${attrs}>`, "href");
    if (!href || !isWebUrl(href)) return inner;
    links.push(href);
    return `${inner}${LINK_MARK(links.length - 1)}`;
  });
  body = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6]|ul|ol|section)>/gi, "\n")
    .replace(/<\/table>/gi, "\n\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return { lines: tidy(decodeEntities(body)), links, images };
}

function tidy(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** Plain text: bare urls become link markers, in the same shape as the HTML path. */
export function textToMarked(text: string): Marked {
  const links: string[] = [];
  const marked = text.replace(/https?:\/\/[^\s<>"')\]]+/gi, (url) => {
    links.push(url.replace(/[.,;]+$/, ""));
    return LINK_MARK(links.length - 1);
  });
  return { lines: tidy(marked), links, images: [] };
}

function strip(line: string): string {
  return line.replace(MARK_RE, "").replace(/\s+/g, " ").trim();
}

function markersIn(lines: string[]): { kind: "L" | "I"; index: number }[] {
  return lines.flatMap((line) =>
    [...line.matchAll(MARK_RE)].map((m) => ({ kind: m[1] as "L" | "I", index: Number(m[2]) })),
  );
}

/** Cut the block at the first footer line. */
function withoutFooter(lines: string[]): string[] {
  const at = lines.findIndex((line) => FOOTER.test(strip(line)));
  return at >= 0 ? lines.slice(0, at) : lines;
}

function blockToListing(
  lines: string[],
  marked: Marked,
  sender: Sender,
  meta: RawListing["meta"],
  url: string | null,
): RawListing | null {
  const kept = withoutFooter(lines);
  const text = kept.map(strip).filter(Boolean).join("\n");
  if (text.length < 15) return null;
  const photoUrls = [
    ...new Set(
      markersIn(kept)
        .filter((m) => m.kind === "I")
        .map((m) => marked.images[m.index])
        .filter((u): u is string => !!u),
    ),
  ];
  return {
    channel: "gmail_alerts",
    source: sender,
    url,
    title: text.split("\n")[0]?.slice(0, 200) ?? null,
    text,
    photoUrls,
    photoHashes: [],
    meta,
  };
}

/** A Facebook notification subject: "Name posted in Group" or "New post in Group". */
export function parseFacebookSubject(subject: string): { posterName: string | null; groupName: string | null } {
  const posted = /^(.+?)\s+(?:posted|shared|wrote|asked)\s+in\s+(.+?)\s*$/i.exec(subject);
  if (posted) return { posterName: posted[1] ?? null, groupName: posted[2] ?? null };
  const generic = /\bin\s+(.+?)\s*$/i.exec(subject);
  return { posterName: null, groupName: generic?.[1] ?? null };
}

export function parseEmail(message: EmailInput): { sender: Sender | null; listings: RawListing[] } {
  const header = (name: string) => message.headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const sender = senderOf(header("from"));
  if (!sender) return { sender: null, listings: [] };
  const subject = header("subject");
  const meta = { messageId: message.id, sender, subject: subject.slice(0, 200) };

  const marked = message.html ? htmlToMarked(message.html) : textToMarked(message.plainText ?? "");
  if (marked.lines.length === 0) return { sender, listings: [] };

  const pattern = LISTING_LINK[sender];
  const listingLinkAt = (line: string): string | null => {
    for (const m of line.matchAll(MARK_RE)) {
      const url = m[1] === "L" ? marked.links[Number(m[2])] : undefined;
      if (url && pattern.test(url)) return url;
    }
    return null;
  };

  if (sender === "facebook_group") {
    const names = parseFacebookSubject(subject);
    const postLine = marked.lines.map(listingLinkAt).find((u): u is string => u !== null);
    const lines = [subject, "", ...marked.lines];
    const listing = blockToListing(lines, marked, sender, meta, postLine ? canonicalUrl(postLine) : null);
    if (!listing) return { sender, listings: [] };
    return { sender, listings: [{ ...listing, groupName: names.groupName, posterName: names.posterName }] };
  }

  // Digest emails: each distinct listing link starts a block.
  const anchors: { url: string; line: number }[] = [];
  for (const [index, line] of marked.lines.entries()) {
    const url = listingLinkAt(line);
    if (url && !anchors.some((a) => canonicalUrl(a.url) === canonicalUrl(url))) anchors.push({ url, line: index });
  }
  if (anchors.length === 0) {
    const whole = blockToListing(marked.lines, marked, sender, meta, null);
    return { sender, listings: whole ? [whole] : [] };
  }
  const starts = anchors.map((anchor, i) => {
    if (i === 0) return 0;
    const floor = (anchors[i - 1]?.line ?? 0) + 1;
    for (let line = anchor.line; line > floor; line -= 1) if (marked.lines[line - 1] === "") return line;
    return anchor.line;
  });
  const listings: RawListing[] = [];
  for (const [i, anchor] of anchors.entries()) {
    const block = marked.lines.slice(starts[i], starts[i + 1] ?? marked.lines.length);
    const listing = blockToListing(block, marked, sender, meta, canonicalUrl(anchor.url));
    if (listing) listings.push(listing);
  }
  return { sender, listings };
}
