import { configuredAppUrl, appOriginPermission } from "./capture.js";
const form = document.querySelector<HTMLFormElement>("form")!;
const appUrl = document.querySelector<HTMLInputElement>("#app-url")!;
const token = document.querySelector<HTMLInputElement>("#token")!;
const status = document.querySelector<HTMLElement>("#status")!;
chrome.storage.local.get(["appUrl", "captureToken"]).then((saved) => {
  appUrl.value = typeof saved.appUrl === "string" ? saved.appUrl : "";
  token.value = typeof saved.captureToken === "string" ? saved.captureToken : "";
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const url = configuredAppUrl(appUrl.value.trim());
    if (token.value.length < 16) throw new Error("Use a token of at least 16 characters.");
    // Request synchronously from Save's user gesture, before any storage work.
    const origin = appOriginPermission(url.href);
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error("App access was declined. Settings were not saved.");
    await chrome.storage.local.set({ appUrl: url.href, captureToken: token.value });
    const permissions = await chrome.permissions.getAll();
    const stale = (permissions.origins ?? []).filter((permission) => permission !== origin);
    // contains handles Chrome's normalisation of host patterns and ports.
    for (const permission of stale) {
      const host = permission.replace(/\*$/, "");
      if (new URL(host).hostname !== url.hostname || !permission.startsWith(`${url.protocol}//`))
        await chrome.permissions.remove({ origins: [permission] });
    }
    status.textContent = "Saved.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not save.";
  }
});
