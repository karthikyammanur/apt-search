import { describe, expect, it } from "vitest";
import { findNonReadonlyGmailScopes, loadSourceFiles } from "./rules";

const READONLY = "https://www.googleapis.com/auth/gmail.readonly";

describe("guard: Gmail scopes are only gmail.readonly", () => {
  it("every Gmail scope under src/ is gmail.readonly", () => {
    expect(findNonReadonlyGmailScopes(loadSourceFiles())).toEqual([]);
  });

  it("detector allows readonly and ordinary gmail.com addresses", () => {
    const ok = { path: "src/a.ts", text: `const s = "${READONLY}"; const e = "me@gmail.com";` };
    expect(findNonReadonlyGmailScopes([ok])).toEqual([]);
  });

  it.each([
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    "https://mail.google.com/",
  ])("detector flags %s", (scope) => {
    const file = { path: "src/a.ts", text: `scopes: ["${READONLY}", "${scope}"]` };
    expect(findNonReadonlyGmailScopes([file])).toHaveLength(1);
  });

  it("detector flags a shorthand scope name", () => {
    expect(
      findNonReadonlyGmailScopes([{ path: "src/a.ts", text: 'scope: "gmail.send"' }]),
    ).toHaveLength(1);
  });
});
