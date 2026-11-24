# Browser extension

Run `node extension/build.mjs`. In Chrome, open `chrome://extensions`, enable Developer mode,
choose Load unpacked and select `extension/dist`.

Open Options and enter the app URL and capture token. The token stays in local extension storage.
Open a listing and click Capture this page. On a Facebook group page, Capture visible posts
collects only posts intersecting the viewport. Reopen the popup after scrolling yourself.
Keep the popup open until the capture result appears. No content script runs in the background.

The app must be running. Remote apps require HTTPS. Only the configured app receives requests,
and redirects are rejected. Saving Options requests optional host access only to the configured
app origin. Accept that request to enable capture. Changing the app removes access to the previous
host. Facebook pages use activeTab only and cannot be configured as the app origin. The popup sends
the capture request; the injected parser has no network calls. Photo links are sent as text and
are never downloaded by the extension. The capture route needs no CORS changes.

Facebook markup changes often. Posts without a stable permalink or visible text are skipped.
Check the visible count before capturing. A capture can contain at most 50 posts and 30 image links
per post. No scrolling, expanding posts or clicking links happens automatically.
