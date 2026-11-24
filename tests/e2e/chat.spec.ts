import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./env";

// Runs against the e2e server, which uses the scripted model and stubbed map services
// (AGENT_FAKE_MODEL=1 in playwright.config.ts). The demo data is written by the server itself
// (POST /api/chat/e2e-seed), so this file never opens the SQLite file that login.spec.ts uses.

const PASTE = [
  "Fully furnished private room with its own bathroom at 12 Sample Way, Palo Alto, CA.",
  "$1,500 a month, utilities and wifi included, no fees. Available Jan 2 to Aug 31.",
].join("\n");

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

let passId = 0;

test.describe.serial("chat", () => {
  test("pasting a listing shows its card with all-in cost and commute", async ({ page }) => {
    await signIn(page);
    const seeded = await page.request.post("/api/chat/e2e-seed");
    expect(seeded.ok()).toBe(true);
    passId = ((await seeded.json()) as { passListingId: number }).passListingId;
    expect(passId).toBeGreaterThan(0);

    await page.goto("/chat");
    await expect(page.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Message")).toHaveAttribute("placeholder", "Ask anything, or paste a listing");

    await send(page, PASTE);
    await expect(page.getByTestId("user-message").last()).toContainText("Fully furnished private room");
    const card = page.getByTestId("listing-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("card-cost")).toHaveText(/^\$\d{1,3}(,\d{3})*\.\d\d$/);
    await expect(card.getByTestId("card-commute")).toHaveText("22 min");
    await expect(card).toContainText(/Passes|Likely|Needs info|Fails/);

    // Phone width: no horizontal scroll, and the card is redrawn from the saved tool result.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByTestId("listing-card")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("rejecting with a reason shows the weight change, and Undo restores it", async ({ page }) => {
    await signIn(page);
    await page.goto("/chat");
    await send(page, `reject listing #${passId}: too far from Caltrain`);

    const line = page.getByTestId("weight-change").last();
    await expect(line).toContainText(/^Transit quality weight 0\.\d\d to 0\.\d\d\./);
    const [, from, to] = /weight (0\.\d\d) to (0\.\d\d)/.exec((await line.textContent()) ?? "")!;
    expect(Number(to)).toBeGreaterThan(Number(from));
    await expect(page.getByText("Rejected: too far from Caltrain")).toBeVisible();

    await line.getByRole("button", { name: "Undo" }).click();
    // The undo line reads the restored weights from the database: transit quality goes back.
    await expect(line).toContainText(new RegExp(`^Undone\\. .*[Tt]ransit quality.* ${to!.replace(".", "\\.")} to ${from!.replace(".", "\\.")}`));
    await expect(line.getByRole("button", { name: "Undo" })).toHaveCount(0);

    // After a reload the event shows as undone.
    await page.reload();
    await expect(page.getByTestId("weight-change").last()).toContainText("Undone.");
  });
});
