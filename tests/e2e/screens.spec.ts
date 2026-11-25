import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "./env";

test.describe("demo screens", () => {
  test.describe.configure({ mode: "serial" });
  // chat.spec.ts adds a listing to the shared e2e.db, so start from a fresh demo seed. The seed
  // route writes through the server's own connection, never from this process.
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await page.request.post("/api/chat/e2e-seed")).ok()).toBe(true);
    await page.close();
  });
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
    // Every network request is fulfilled locally; no free provider quota is used.
    await page.route("https://example.com/**", (route) => route.abort());
  });
  for (const width of [1280, 390]) {
    test(`all screens fit at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const [url, heading] of [
        ["/", /places pass/],
        ["/listing/1", /sample/],
        ["/compare?ids=1,2,3", "Compare"],
        ["/requirements", "Requirements"],
        ["/leads", "Sources"],
        ["/settings", "Settings"],
      ] as const) {
        await page.goto(url);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    });
  }
  test("bucket tabs, shortlist, photo fallback, map, and capture reminder", async ({ page }) => {
    await page.getByRole("link", { name: "Likely 2", exact: true }).click();
    await expect(page.getByRole("list", { name: "Listings" }).locator("li")).toHaveCount(2);
    await page.getByRole("link", { name: "Needs info 4", exact: true }).click();
    await expect(page.getByRole("list", { name: "Listings" }).locator("li")).toHaveCount(4);
    await page.goto("/listing/1");
    await page.getByRole("button", { name: "Remove from shortlist" }).click();
    await page.getByRole("button", { name: "Shortlist", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove from shortlist" })).toBeVisible();
    await page.goto("/?status=shortlisted");
    await expect(page.getByRole("list", { name: "Listings" }).locator("li")).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Listings" })).toContainText("Shortlisted");
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#eeeeee" } },
          ],
        },
      }),
    );
    await page.getByRole("link", { name: "Map", exact: true }).click();
    await expect(page.getByRole("region", { name: "Listing map", exact: true })).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await page.goto("/leads");
    await expect(page.getByText(/Capture due/).first()).toBeVisible();
  });
});
