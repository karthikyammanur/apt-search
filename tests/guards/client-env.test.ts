import { describe, expect, it } from "vitest";
import { findClientEnvReads, loadSourceFiles } from "./rules";

describe('guard: no "use client" file reads process.env', () => {
  it("no client component under src/ reads process.env", () => {
    expect(findClientEnvReads(loadSourceFiles())).toEqual([]);
  });

  it("detector flags client files only, including after a leading comment", () => {
    const client = '"use client";\nexport const k = process.env.NEXT_PUBLIC_X;';
    const afterComment = "// note\n'use client'\nconst k = process['env'].KEY;";
    const server = "export const k = process.env.APP_PASSWORD;";
    expect(findClientEnvReads([{ path: "src/a.tsx", text: client }])).toHaveLength(1);
    expect(findClientEnvReads([{ path: "src/b.tsx", text: afterComment }])).toHaveLength(1);
    expect(findClientEnvReads([{ path: "src/c.ts", text: server }])).toEqual([]);
  });
});
