import { capture } from "./capture.js";
import { readVisiblePage } from "./parser.js";

const name = document.querySelector<HTMLElement>("#page-name")!;
const count = document.querySelector<HTMLElement>("#count")!;
const status = document.querySelector<HTMLElement>("#status")!;
const button = document.querySelector<HTMLButtonElement>("#capture")!;
const pageButton = document.querySelector<HTMLButtonElement>("#capture-page")!;
document
  .querySelector("#options")!
  .addEventListener("click", () => void chrome.runtime.openOptionsPage());
let tabId: number | undefined;
let group = false;

async function inspect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  name.textContent = tab?.title ?? "Current page";
  if (!tabId || !tab?.url || !/^https?:/.test(tab.url)) throw new Error("Open a web page first.");
  const [inspection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: readVisiblePage,
  });
  const result = inspection?.result;
  if (!result) throw new Error("This page cannot be captured.");
  group = result.isGroup;
  count.textContent = group
    ? `${result.posts.length} posts on screen`
    : "Visible text and image links";
  button.textContent = group ? "Capture visible posts" : "Capture this page";
  button.disabled = group && !result.posts.length;
  pageButton.hidden = !group;
  const saved = await chrome.storage.local.get(["lastCapture"]);
  status.textContent =
    typeof saved.lastCapture === "string"
      ? `Last time: ${saved.lastCapture}`
      : "Nothing captured yet.";
}
async function run(single: boolean) {
  button.disabled = true;
  pageButton.disabled = true;
  try {
    if (!tabId) throw new Error("Open a web page first.");
    const [inspection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readVisiblePage,
    });
    const result = inspection?.result;
    if (!result) throw new Error("This page cannot be captured.");
    if (group && !single && !result.posts.length)
      throw new Error("No visible posts found. Scroll yourself and reopen the extension.");
    const saved = await chrome.storage.local.get(["appUrl", "captureToken"]);
    status.textContent = "Capturing. Keep this popup open.";
    const summary = await capture(
      saved.appUrl,
      saved.captureToken,
      group && !single ? { posts: result.posts, groupName: result.groupName } : result.page,
    );
    await chrome.storage.local.set({ lastCapture: summary });
    status.textContent = summary;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Capture failed.";
  } finally {
    button.disabled = false;
    pageButton.disabled = false;
  }
}
button.addEventListener("click", () => void run(false));
pageButton.addEventListener("click", () => void run(true));
inspect().catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : "Cannot inspect this page.";
});
