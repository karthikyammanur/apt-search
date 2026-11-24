// The login gate skips /api/capture and /api/cron/*, and those routes still refuse a call
// without their own secret. Handlers are called directly; neither reaches createDeps on a 401.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { POST as capturePost } from "@/app/api/capture/route";
import { GET as cronGet } from "@/app/api/cron/intake/route";

const BASE = "http://localhost:3000";
const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: `${BASE}${path}` });

beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", "gate-password-for-tests");
  vi.stubEnv("CAPTURE_TOKEN", "capture-token-for-tests-0123456789");
  vi.stubEnv("CRON_SECRET", "cron-secret-for-tests-0123456789");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy matcher", () => {
  it("does not run the login gate on the two machine routes", () => {
    expect(matches("/api/capture")).toBe(false);
    expect(matches("/api/cron/intake")).toBe(false);
  });

  it("still gates every other API route, including look-alike paths", () => {
    for (const path of ["/api/chat", "/api/captures", "/api/capture/extra", "/api/cronjob", "/", "/board"]) {
      expect(matches(path), path).toBe(true);
    }
  });
});

describe("proxy function without a cookie", () => {
  it("passes the machine routes through", async () => {
    for (const path of ["/api/capture", "/api/cron/intake"]) {
      const res = await proxy(new NextRequest(`${BASE}${path}`));
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("answers 401 on any other API route", async () => {
    for (const path of ["/api/chat", "/api/captures", "/api/cronjob"]) {
      const res = await proxy(new NextRequest(`${BASE}${path}`));
      expect(res.status, path).toBe(401);
    }
  });
});

describe("machine routes reach their handlers and enforce their own secret", () => {
  it("/api/capture: 401 with no token and with a wrong token", async () => {
    const body = JSON.stringify({ kind: "page", url: "https://example.com/x", text: "hello" });
    const noToken = await capturePost(new Request(`${BASE}/api/capture`, { method: "POST", body }));
    expect(noToken.status).toBe(401);

    const wrong = await capturePost(
      new Request(`${BASE}/api/capture`, { method: "POST", body, headers: { "X-Capture-Token": "wrong" } }),
    );
    expect(wrong.status).toBe(401);
  });

  it("/api/cron/intake: 401 with no header, a wrong secret, and no CRON_SECRET configured", async () => {
    const noHeader = await cronGet(new Request(`${BASE}/api/cron/intake`));
    expect(noHeader.status).toBe(401);

    const wrong = await cronGet(
      new Request(`${BASE}/api/cron/intake`, { headers: { authorization: "Bearer not-the-secret-at-all" } }),
    );
    expect(wrong.status).toBe(401);

    vi.stubEnv("CRON_SECRET", "");
    const unset = await cronGet(new Request(`${BASE}/api/cron/intake`, { headers: { authorization: "Bearer " } }));
    expect(unset.status).toBe(401);
  });
});
