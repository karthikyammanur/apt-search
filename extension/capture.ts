export type PageCapture = { url: string; title: string; text: string; photoUrls: string[] };
export type PostCapture = {
  postUrl: string;
  groupName: string | null;
  posterName: string | null;
  posterProfileUrl: string | null;
  text: string;
  photoUrls: string[];
};
export type CapturePayload = PageCapture | { posts: PostCapture[]; groupName?: string | null };

export function configuredAppUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Set the app URL in Options first.");
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Use an http or https app URL without credentials, query or fragment.");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Use HTTPS for a remote app.");
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/i.test(url.hostname))
    throw new Error("The app URL cannot be a Facebook page.");
  return url;
}
export function appOriginPermission(value: unknown): string {
  return `${configuredAppUrl(value).origin}/*`;
}
export function captureRequest(appUrl: unknown, token: unknown, payload: CapturePayload) {
  const app = configuredAppUrl(appUrl);
  if (typeof token !== "string" || token.length < 16)
    throw new Error("Set a capture token of at least 16 characters in Options.");
  return {
    url: new URL(`${app.pathname.replace(/\/$/, "")}/api/capture`, app.origin).href,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Capture-Token": token },
      body: JSON.stringify(payload),
      redirect: "error" as const,
      credentials: "omit" as const,
    },
  };
}
export async function capture(
  appUrl: unknown,
  token: unknown,
  payload: CapturePayload,
): Promise<string> {
  const request = captureRequest(appUrl, token, payload);
  if (!(await chrome.permissions.contains({ origins: [appOriginPermission(appUrl)] })))
    throw new Error("Allow access to the app by saving Options again.");
  const response = await fetch(request.url, {
    ...request.init,
    signal: AbortSignal.timeout(290000),
  });
  if (!response.ok)
    throw new Error(`Capture failed (${response.status}). Check Options and try again.`);
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("results" in result) ||
    !Array.isArray(result.results) ||
    !result.results.every(
      (r: unknown) => r && typeof r === "object" && "status" in r && typeof r.status === "string",
    )
  )
    throw new Error("Unexpected app response.");
  const rows = result.results as { status: string }[];
  // Posts the app had no time to process are saved and finished by its next scheduled run.
  const pending = "pending" in result && typeof result.pending === "number" ? result.pending : 0;
  const summary = `${rows.filter((r) => r.status === "stored").length} listings added, ${rows.filter((r) => r.status === "roommate_lead").length} roommate leads, ${rows.filter((r) => r.status !== "stored" && r.status !== "roommate_lead").length} skipped or failed.`;
  return pending > 0 ? `${summary} ${pending} saved, will finish processing later.` : summary;
}
