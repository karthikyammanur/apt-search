import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "./env";

test("wrong password is rejected, right password reaches the home page", async ({ page }) => {
  // The gate redirects everything else to /login.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  // Wrong password: error shown, still locked out.
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong password.")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  // Right password: lands on the home page.
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Apartment Finder" })).toBeVisible();

  // The cookie is httpOnly, so page scripts cannot read it.
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === "af_session");
  expect(session?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("af_session");
});
