import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readVisiblePage } from "../../extension/parser";
import { batchSchema } from "@/lib/intake/capture";

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.route("**/*", (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: "text/html",
          body: readFileSync("tests/views/fixtures/group.html", "utf8"),
        })
      : route.abort(),
  );
  await page.goto("https://www.facebook.com/groups/sample/");
}, 20000);
afterAll(async () => {
  await browser?.close();
});
describe("saved anonymised group parser", () => {
  it("reads visible posts, authors, photos and stable permalinks only", async () => {
    const result = await page.evaluate(readVisiblePage);
    expect(result.isGroup).toBe(true);
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]).toMatchObject({
      postUrl: "https://www.facebook.com/groups/sample/posts/101/",
      groupName: "Sample housing group",
      posterName: "Sample Person",
      posterProfileUrl: "https://www.facebook.com/profile.php?id=100",
      photoUrls: ["https://example.com/room.jpg"],
    });
    expect(result.posts[1]?.text).toContain("Looking for a roommate");
    expect(JSON.stringify(result)).not.toContain("below the viewport");
    expect(batchSchema.safeParse({ posts: result.posts }).success).toBe(true);
  });
  it("never scrolls, clicks, or includes offscreen content", async () => {
    const before = await page.evaluate(() => scrollY);
    await page.evaluate(readVisiblePage);
    expect(await page.evaluate(() => scrollY)).toBe(before);
  });
  it("does not treat an unrelated hostname as a group", async () => {
    await page.goto("https://facebook.com.example.org/groups/sample/");
    const result = await page.evaluate(readVisiblePage);
    expect(result.isGroup).toBe(false);
    expect(result.posts).toEqual([]);
  });
});
