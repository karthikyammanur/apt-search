// Opt-in live verification. Never run from the fixture suite.
// Starts a local app with example settings and an ephemeral token, then waits for a
// human or UI driver to accept app-host permission and click Capture this page.
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const databaseUrl = "file:data/step7-live.db";
const appUrl = "http://localhost:3120";
const token = randomBytes(32).toString("hex");
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DATABASE_AUTH_TOKEN: "",
  CAPTURE_TOKEN: token,
  APP_PASSWORD: randomBytes(24).toString("hex"),
};
const seed = spawnSync(process.execPath, ["--import", "tsx", "src/db/seed-demo.ts", "--reset"], {
  env,
  stdio: "inherit",
  timeout: 30000,
});
if (seed.status !== 0) throw new Error("Could not prepare the isolated live database");
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--port", "3120"],
  { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);
let readyResolve;
const ready = new Promise((resolve) => {
  readyResolve = resolve;
});
server.stdout.on("data", (chunk) => {
  if (chunk.toString().includes("Ready")) readyResolve();
});
server.stderr.on("data", () => {});
let context;
try {
  await Promise.race([
    ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Local app did not start")), 30000),
    ),
  ]);
  const extension = path.resolve("extension/dist");
  const profile = mkdtempSync(path.join(tmpdir(), "finder-live-"));
  const browserOptions = {
    channel: "chromium",
    headless: false,
    viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  };
  context = await chromium.launchPersistentContext(profile, browserOptions);
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  const item = manager.locator("extensions-item").filter({ hasText: "Apartment finder" });
  await item.waitFor();
  const id = await item.getAttribute("id");
  if (!id) throw new Error("Unpacked extension did not load");
  console.log("Unpacked extension loaded in Chrome.");
  // Restart the disposable browser to reload the rebuilt unpacked extension.
  await context.close();
  context = await chromium.launchPersistentContext(profile, browserOptions);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  console.log("Rebuilt extension reloaded after Chrome restart.");
  await options.getByLabel("App URL").fill(appUrl);
  await options.getByLabel("Capture token").fill(token);
  await options.getByRole("button", { name: "Save", exact: true }).click();
  console.log("Waiting for the configured-app permission prompt.");
  await options.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 180000 });
  const permissions = await options.evaluate(() => chrome.permissions.getAll());
  console.log(`Granted app hosts: ${JSON.stringify(permissions.origins ?? [])}`);
  const listing = await context.newPage();
  await listing.goto("https://supost.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await listing.bringToFront();
  console.log(
    "SUPost is open. Choose one housing listing, then click the extension and Capture this page.",
  );
  // Chrome action popups are separate browser targets and their network events are not
  // consistently surfaced by Playwright. Verify the authoritative database write instead.
  const deadline = Date.now() + 360000;
  for (;;) {
    const verify = spawnSync(process.execPath, ["--import", "tsx", "tests/views/verify-live.ts"], {
      env,
      encoding: "utf8",
      timeout: 30000,
    });
    if (verify.status === 0) {
      console.log(verify.stdout.trim());
      break;
    }
    if (Date.now() >= deadline) throw new Error("Live capture was not recorded before the timeout");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await listing.screenshot({ path: "test-results/live-supost.png" });
  console.log("Live capture verified. Closing the disposable browser and local app.");
} finally {
  await context?.close();
  server.kill();
}
