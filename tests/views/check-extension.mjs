// Manual browser diagnostic: build the extension, then run this against a local app.
// Uses a disposable profile, a local sample page and a deliberately invalid token.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const appUrl = process.argv[2] ?? "http://localhost:3120";
const extension = path.resolve("extension/dist");
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(
    "<!doctype html><title>Sample listing</title><h1>Furnished sample room</h1><p>Private bath. Sample listing for extension verification.</p>",
  );
});
await new Promise((resolve) => server.listen(3121, "127.0.0.1", resolve));
let context;
try {
  context = await chromium.launchPersistentContext(
    mkdtempSync(path.join(tmpdir(), "finder-extension-")),
    {
      channel: "chromium",
      headless: false,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    },
  );
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  const item = manager.locator("extensions-item").filter({ hasText: "Apartment finder" });
  await item.waitFor();
  const id = await item.getAttribute("id");
  if (!id) throw new Error("Loaded extension has no ID");
  console.log("Unpacked extension loaded in Chromium.");
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByLabel("App URL").fill(appUrl);
  await options.getByLabel("Capture token").fill("invalid-sample-token-123456");
  await options.getByRole("button", { name: "Save", exact: true }).click();
  await options.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 180000 });
  const permissions = await options.evaluate(() => globalThis.chrome.permissions.getAll());
  console.log(`Granted app hosts: ${JSON.stringify(permissions.origins ?? [])}`);
  const sample = await context.newPage();
  await sample.goto("http://127.0.0.1:3121");
  const popup = await context.newPage();
  // A standalone popup tab has no activeTab grant for the sample. Give the test a snapshot
  // of the sample DOM to isolate the real extension-origin request and the app's CORS policy.
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const outcome = await popup.evaluate(async (url) => {
    const { capture } = await import("./capture.js");
    try {
      return await capture(url, "invalid-sample-token-123456", {
        url: "http://127.0.0.1:3121",
        title: "Sample listing",
        text: "Furnished sample room with private bath.",
        photoUrls: [],
      });
    } catch (error) {
      return error instanceof Error ? error.message : "Capture failed";
    }
  }, appUrl);
  console.log(`Extension-origin request outcome: ${outcome}`);
  if (!outcome.includes("401"))
    throw new Error("Expected the unchanged route to reject the invalid token with HTTP 401");
  const preflight = await context.request.fetch(`${appUrl}/api/capture`, {
    method: "OPTIONS",
    headers: {
      Origin: `chrome-extension://${id}`,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-capture-token",
    },
  });
  console.log(
    `App preflight status: ${preflight.status()}; allow-origin: ${preflight.headers()["access-control-allow-origin"] ?? "missing"}; allow-headers: ${preflight.headers()["access-control-allow-headers"] ?? "missing"}`,
  );
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
}
