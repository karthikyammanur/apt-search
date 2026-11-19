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

test.describe("login rate limit", () => {
  // A made-up client address, so this test locks out only itself. The server trusts the header
  // because nothing sits in front of it here. On Vercel the platform sets it.
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" } });

  test("five wrong passwords lock the client out, even for the right password", async ({
    page,
  }) => {
    await page.goto("/login");
    const submit = async (password: string) => {
      await page.getByLabel("Password").fill(password);
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === "POST" && new URL(response.url()).pathname === "/login",
        ),
        page.getByRole("button", { name: "Sign in" }).click(),
      ]);
    };

    for (let attempt = 0; attempt < 5; attempt += 1) await submit("not-the-password");
    await expect(page.getByText("Wrong password.")).toBeVisible();

    await submit(E2E_PASSWORD);
    await expect(page.getByText(/Too many wrong passwords/)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
