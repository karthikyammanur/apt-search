// The shared header (docs/ui/Main.dc.html): app name, four text nav links, the current page marked
// with aria-current and underlined, the 760 px column, 44 px touch targets, and no background,
// border or icons. Rendered to static markup, no browser needed.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppHeader, NAV_ITEMS } from "@/components/app-header";

const render = (props: Parameters<typeof AppHeader>[0]) => renderToStaticMarkup(createElement(AppHeader, props));
const readSource = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

describe("AppHeader", () => {
  it("links Listings, Chat, Sources and Settings", () => {
    const html = render({ current: "listings" });
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Listings", "Chat", "Sources", "Settings"]);
    for (const item of NAV_ITEMS) expect(html).toContain(`href="${item.href}"`);
    expect(html).toContain('aria-label="Main"');
    expect(html).toContain("Apartment finder");
  });

  it.each(NAV_ITEMS.map((i) => i.id))("marks and underlines only %s as the current page", (id) => {
    const html = render({ current: id });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const item = NAV_ITEMS.find((i) => i.id === id)!;
    const navLinks = (html.match(/<a [^>]*>/g) ?? []).slice(1);
    const marked = navLinks.filter((tag) => tag.includes('aria-current="page"'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(`href="${item.href}"`);
    expect(marked[0]).toMatch(/class="[^"]*\bunderline\b/);
    for (const other of navLinks.filter((tag) => tag !== marked[0])) {
      expect(other).toContain("no-underline");
      expect(other).toContain("text-muted-foreground");
    }
  });

  it("marks nothing when no page is current", () => {
    expect(render({})).not.toContain("aria-current");
  });

  it("sits in the 760 px column, wraps, and gives every link a 44 px touch target", () => {
    const html = render({ current: "chat" });
    expect(html).toMatch(/<header class="[^"]*\bmax-w-column\b[^"]*\bmx-auto\b|<header class="[^"]*\bmx-auto\b[^"]*\bmax-w-column\b/);
    expect(html.match(/flex-wrap/g)?.length).toBeGreaterThanOrEqual(2);
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links).toHaveLength(5);
    for (const link of links) expect(link).toContain("min-h-touch");
  });

  it("has no background, border or icons", () => {
    const html = render({ current: "settings" });
    const header = /<header [^>]*>/.exec(html)?.[0] ?? "";
    expect(header).not.toMatch(/\bbg-|\bborder\b|\bborder-/);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
  });
});

describe("theme tokens", () => {
  const css = readSource("src", "app", "globals.css").toLowerCase();

  it.each([
    ["bg", "#ffffff"],
    ["ink", "#111111"],
    ["muted", "#6b6e76"],
    ["line", "#ececec"],
    ["field", "#ddddda"],
    ["fill", "#f2f2f0"],
    ["thumb", "#e9e9e6"],
    ["accent", "#1f4fd1"],
    ["attention", "#8a4b00"],
  ])("defines %s as %s from docs/ui/README.md", (token, hex) => {
    expect(css).toContain(`--app-${token}: ${hex};`);
  });

  it("sets the layout tokens", () => {
    expect(css).toContain("--spacing-touch: 44px;");
    expect(css).toContain("--container-column: 760px;");
  });

  it("styles buckets and provenance as text with a dot, not filled chips", () => {
    for (const bucket of ["pass", "likely", "needs_info", "fail"]) expect(css).toContain(`[data-bucket="${bucket}"]`);
    expect(css).toContain(".bucket::before");
    expect(css).toContain('.provenance[data-provenance="estimate"]');
    const rules = css.match(/\.(?:bucket|provenance)[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules.filter((r) => !r.includes("::before"))) {
      expect(rule).not.toMatch(/background|border:/);
    }
  });

  it("uses Inter only", () => {
    const layout = readSource("src", "app", "layout.tsx");
    expect(layout).toContain("Inter");
    expect(layout).not.toMatch(/space.?grotesk/i);
    expect(css).not.toMatch(/space.?grotesk/);
  });
});
