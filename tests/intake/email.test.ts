import { describe, expect, it } from "vitest";
import { canonicalUrl, htmlToMarked, parseEmail, parseFacebookSubject, senderOf, textToMarked } from "@/lib/intake/channels/email";
import { emailFixture } from "./helpers";

describe("sender recognition", () => {
  it.each([
    ["CL <noreply@mail.craigslist.org>", "craigslist"],
    ["Zillow <noreply@mail.zillow.com>", "zillow"],
    ["HotPads <alerts@hotpads.com>", "hotpads"],
    ["Facebook <notification@facebookmail.com>", "facebook_group"],
    ["noreply@craigslist.org", "craigslist"],
    ["Someone <promo@notcraigslist.org.evil.test>", null],
    ["Phisher <a@zillow.com.evil.test>", null],
    ["Bank <alerts@example.com>", null],
    ["", null],
  ])("%s is %s", (from, expected) => {
    expect(senderOf(from)).toBe(expected);
  });
});

describe("Craigslist alert", () => {
  const { sender, listings } = parseEmail(emailFixture("msg-craigslist-1"));

  it("gives one listing with its link, photo and text", () => {
    expect(sender).toBe("craigslist");
    expect(listings).toHaveLength(1);
    const [listing] = listings;
    expect(listing?.url).toBe("https://sfbay.craigslist.org/pen/roo/d/palo-alto-furnished-room-private-bath/7712345678.html");
    expect(listing?.source).toBe("craigslist");
    expect(listing?.channel).toBe("gmail_alerts");
    expect(listing?.photoUrls).toEqual(["https://images.craigslist.org/00a0a_abc123_600x450.jpg"]);
    expect(listing?.text).toContain("340 Cedar Ln");
    expect(listing?.text).toContain("$1,950");
  });

  it("drops the tracking pixel, the unsubscribe footer and every url from the text", () => {
    const [listing] = listings;
    expect(listing?.photoUrls.join(" ")).not.toContain("open.gif");
    expect(listing?.text.toLowerCase()).not.toContain("unsubscribe");
    expect(listing?.text).not.toMatch(/https?:\/\//);
    expect(listing?.text).not.toContain("⟦");
  });
});

describe("Zillow alert with two listings", () => {
  const { listings } = parseEmail(emailFixture("msg-zillow-1"));

  it("splits into two listings, each with its own link, photo and details", () => {
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.url)).toEqual([
      "https://www.zillow.com/homedetails/410-Oak-St-Menlo-Park-CA-94025/19543_zpid/",
      "https://www.zillow.com/homedetails/77-Birch-Way-Mountain-View-CA-94041/20871_zpid/",
    ]);
    expect(listings[0]?.photoUrls).toEqual(["https://photos.zillowstatic.com/fp/aaa-p_e.jpg"]);
    expect(listings[1]?.photoUrls).toEqual(["https://photos.zillowstatic.com/fp/bbb-p_e.jpg"]);
  });

  it("keeps each listing's details out of the other's text", () => {
    expect(listings[0]?.text).toContain("$2,350/mo");
    expect(listings[0]?.text).toContain("410 Oak St");
    expect(listings[0]?.text).not.toContain("$3,900");
    expect(listings[1]?.text).toContain("$3,900/mo");
    expect(listings[1]?.text).toContain("77 Birch Way");
    expect(listings[1]?.text).not.toContain("$2,350");
  });

  it("leaves the alert-management footer out", () => {
    for (const listing of listings) {
      expect(listing.text.toLowerCase()).not.toContain("manage your alerts");
      expect(listing.text.toLowerCase()).not.toContain("unsubscribe");
    }
  });
});

describe("Facebook group notification", () => {
  const { sender, listings } = parseEmail(emailFixture("msg-facebook-1"));

  it("gives one post with the group, the poster and the post link", () => {
    expect(sender).toBe("facebook_group");
    expect(listings).toHaveLength(1);
    const [post] = listings;
    expect(post?.source).toBe("facebook_group");
    expect(post?.groupName).toBe("Bay Area Furnished Rentals & Sublets");
    expect(post?.posterName).toBe("Priya Raman");
    expect(post?.url).toContain("/groups/123456789/posts/987654321/");
    expect(post?.photoUrls).toEqual(["https://scontent.xx.fbcdn.net/v/t39.30808-6/room-photo.jpg"]);
    expect(post?.text).toContain("220 Pine St");
  });

  it("does not take the settings link for the post", () => {
    expect(listings[0]?.url).not.toContain("settings");
  });
});

describe("helpers", () => {
  it("reads the group and poster from a notification subject", () => {
    expect(parseFacebookSubject("Dana W posted in Room Rentals")).toEqual({ posterName: "Dana W", groupName: "Room Rentals" });
    expect(parseFacebookSubject("New post in Room Rentals")).toEqual({ posterName: null, groupName: "Room Rentals" });
  });

  it("canonicalizes listing links by dropping tracking, but keeps a Facebook post id", () => {
    expect(canonicalUrl("https://www.zillow.com/homedetails/x/1_zpid/?utm_source=a#top")).toBe("https://www.zillow.com/homedetails/x/1_zpid/");
    expect(canonicalUrl("https://www.facebook.com/permalink.php?story_fbid=9&id=2#x")).toBe("https://www.facebook.com/permalink.php?story_fbid=9&id=2");
  });

  it("reads links out of a plain-text email as data", () => {
    const marked = textToMarked("New: https://sfbay.craigslist.org/pen/roo/d/x/7712345678.html\n$1,900 room");
    expect(marked.links).toEqual(["https://sfbay.craigslist.org/pen/roo/d/x/7712345678.html"]);
    expect(marked.lines.join("\n")).not.toContain("http");
  });

  it("ignores non-web links and tiny images", () => {
    const marked = htmlToMarked('<a href="javascript:alert(1)">x</a><a href="mailto:a@b.c">y</a><img src="https://a.test/i.png" width="20" height="20">');
    expect(marked.links).toEqual([]);
    expect(marked.images).toEqual([]);
  });

  it("an email from an unknown sender yields nothing", () => {
    const message = emailFixture("msg-craigslist-1");
    message.headers = [{ name: "From", value: "Bank <alerts@example.com>" }];
    expect(parseEmail(message)).toEqual({ sender: null, listings: [] });
  });
});
