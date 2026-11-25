import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  capture,
  captureRequest,
  configuredAppUrl,
  appOriginPermission,
} from "../../extension/capture";
import { pageSchema, batchSchema } from "@/lib/intake/capture";

const page = {
  url: "https://example.com/listing",
  title: "Sample room",
  text: "Furnished room",
  photoUrls: ["https://example.com/photo.jpg"],
};
afterEach(() => vi.unstubAllGlobals());
beforeEach(() =>
  vi.stubGlobal("chrome", { permissions: { contains: vi.fn().mockResolvedValue(true) } }),
);
describe("extension capture", () => {
  it("matches the existing endpoint shape and token header", () => {
    const request = captureRequest("https://finder.example.com/", "sample-token-123456", page);
    expect(request.url).toBe("https://finder.example.com/api/capture");
    expect(request.init.headers["X-Capture-Token"]).toBe("sample-token-123456");
    expect(pageSchema.safeParse(JSON.parse(request.init.body)).success).toBe(true);
    const batch = {
      posts: [
        {
          postUrl: "https://example.com/post",
          groupName: "Sample group",
          posterName: "Sample person",
          posterProfileUrl: null,
          text: "Sample room",
          photoUrls: [],
        },
      ],
    };
    expect(
      batchSchema.safeParse(
        JSON.parse(captureRequest("http://localhost:3000", "sample-token-123456", batch).init.body),
      ).success,
    ).toBe(true);
  });
  it.each([
    "https://name:secret@example.com",
    "javascript:alert(1)",
    "http://example.com",
    "https://example.com?destination=elsewhere",
  ])("rejects unsafe configured URL %s", (url) => expect(() => configuredAppUrl(url)).toThrow());
  it("sends only to the configured origin and reports actual outcomes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{ status: "stored" }, { status: "roommate_lead" }, { status: "irrelevant" }],
        }),
      });
    vi.stubGlobal("fetch", fetcher);
    expect(await capture("https://finder.example.com", "sample-token-123456", page)).toBe(
      "1 listings added, 1 roommate leads, 1 skipped or failed.",
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://finder.example.com/api/capture");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
      method: "POST",
    });
  });
  it("does not report success after an authentication failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(
      capture("https://finder.example.com", "sample-token-123456", page),
    ).rejects.toThrow("401");
  });
  it("requests only the configured app origin, never Facebook", () => {
    expect(appOriginPermission("http://localhost:3000/subpath")).toBe("http://localhost:3000/*");
    expect(appOriginPermission("https://finder.example.com/path")).toBe(
      "https://finder.example.com/*",
    );
    expect(() => appOriginPermission("https://www.facebook.com/groups/sample")).toThrow();
  });
  it("never makes a request without app permission", async () => {
    vi.stubGlobal("chrome", { permissions: { contains: vi.fn().mockResolvedValue(false) } });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      capture("https://finder.example.com", "sample-token-123456", page),
    ).rejects.toThrow("saving Options");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
