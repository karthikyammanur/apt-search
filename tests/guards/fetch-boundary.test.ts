import { describe, expect, it } from "vitest";
import { findFetchOutsideProviders, loadSourceFiles } from "./rules";

describe("guard: fetch only inside src/lib/providers/", () => {
  it("no file under src/ outside providers calls fetch", () => {
    expect(findFetchOutsideProviders(loadSourceFiles())).toEqual([]);
  });

  it("detector flags a call outside providers and allows one inside", () => {
    const text = 'const r = await fetch("https://example.com");';
    expect(findFetchOutsideProviders([{ path: "src/app/page.tsx", text }])).toHaveLength(1);
    expect(findFetchOutsideProviders([{ path: "src/lib/providers/x.ts", text }])).toEqual([]);
    expect(
      findFetchOutsideProviders([{ path: "src/a.ts", text: "globalThis.fetch (u)" }]),
    ).toHaveLength(1);
  });
});
