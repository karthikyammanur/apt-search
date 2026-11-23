// POST /api/capture: pages and Facebook posts sent by the browser extension.
// Authenticated by the X-Capture-Token header, not the login cookie. Only POST exists, so any
// other method is answered 405 by Next.

import { createDeps } from "@/lib/intake/deps";
import { CAPTURE_TOKEN_HEADER, MAX_BODY_CHARS, handleCapture } from "@/lib/intake/capture";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const token = request.headers.get(CAPTURE_TOKEN_HEADER);
  const expectedToken = process.env.CAPTURE_TOKEN;

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Left null: the handler answers 401 first if the token is wrong, else 400.
  }
  const result = await handleCapture({ token, expectedToken, body }, () => createDeps());
  return Response.json(result.body, { status: result.status });
}
