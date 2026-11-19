import { describe, expect, it } from "vitest";
import { findFetchOutsideProviders, loadFetchScopeFiles } from "./rules";

describe("guard: fetch only in src/lib/providers/ and the offline scripts/gtfs/ job", () => {
  it("no file under src/ or scripts/ outside those two folders calls fetch", () => {
    expect(findFetchOutsideProviders(loadFetchScopeFiles())).toEqual([]);
  });

  it("detector flags a call outside the allowed folders and allows one inside", () => {
    const text = 'const r = await fetch("https://example.com");';
    expect(findFetchOutsideProviders([{ path: "src/app/page.tsx", text }])).toHaveLength(1);
    expect(findFetchOutsideProviders([{ path: "src/lib/providers/x.ts", text }])).toEqual([]);
    expect(
      findFetchOutsideProviders([{ path: "src/a.ts", text: "globalThis.fetch (u)" }]),
    ).toHaveLength(1);
  });

  it("detector allows scripts/gtfs/ but flags every other script", () => {
    const text = 'await fetch("https://example.com/feed.zip");';
    expect(findFetchOutsideProviders([{ path: "scripts/gtfs/download.ts", text }])).toEqual([]);
    expect(findFetchOutsideProviders([{ path: "scripts/smoke.ts", text }])).toHaveLength(1);
    expect(findFetchOutsideProviders([{ path: "scripts/other/x.ts", text }])).toHaveLength(1);
  });
});
