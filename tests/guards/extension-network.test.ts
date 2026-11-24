import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { loadSourceFiles } from "./rules";

describe("guard: extension network is restricted to the configured app", () => {
  it("has exactly one fetch site, using the validated request and rejecting redirects", () => {
    const calls: { path: string; text: string }[] = [];
    for (const file of loadSourceFiles("extension").filter(
      (file) => !file.path.startsWith("extension/dist/"),
    )) {
      const ast = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (
          (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
          /fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/i.test(
            node.expression.getText(ast),
          )
        )
          calls.push({ path: file.path, text: node.getText(ast) });
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(calls.map((call) => call.path)).toEqual(["extension/capture.ts"]);
    expect(calls[0]!.text.replace(/\s/g, "")).toMatch(
      /^fetch\(request\.url,\{\.\.\.request\.init,signal:AbortSignal\.timeout\(290000\),?\}\)$/,
    );
    const compact = (value: string) => value.replace(/[\s,]/g, "");
    const source = compact(readFileSync("extension/capture.ts", "utf8"));
    expect(source).toContain(compact("const request = captureRequest(appUrl, token, payload)"));
    expect(source).toContain(compact('redirect: "error"'));
    expect(source).toContain(compact('credentials: "omit"'));
    expect(source).toContain(
      compact("chrome.permissions.contains({ origins: [appOriginPermission(appUrl)] }"),
    );
    const options = compact(readFileSync("extension/options.ts", "utf8"));
    expect(options).toContain(compact("chrome.permissions.request({ origins: [origin] }"));
    expect(options).toContain(compact("const origin = appOriginPermission(url.href)"));
    expect(options).toContain(compact("chrome.permissions.remove({ origins: [permission] }"));
    expect(readFileSync("extension/parser.ts", "utf8")).not.toMatch(/\bfetch\s*\(/);
    const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual([
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
      "http://[::1]/*",
    ]);
    expect(manifest.background).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
  });
});
