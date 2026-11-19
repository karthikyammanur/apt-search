// Detectors behind the guard tests. Pure functions over source text so each one can be tested
// on synthetic input (does it fire?) and on the real src/ tree (is it clean?).
//
// Text is scanned raw, comments included. That is deliberate: a comment-stripper bug would turn
// into a silent false negative. The price is that src/ comments must not contain the literal
// strings these rules look for (a call to fetch, a banned domain, a Gmail scope).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export type SourceFile = { path: string; text: string };

const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const SKIPPED_DIRS = new Set(["node_modules", ".next"]);

/** Read every code file under `dir` (relative to the repo root). Paths use forward slashes. */
export function loadSourceFiles(dir = "src", root = repoRoot): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(child);
      } else if (CODE_FILE.test(entry.name)) {
        out.push({ path: child, text: readFileSync(path.join(root, child), "utf8") });
      }
    }
  };
  if (existsSync(path.join(root, dir))) walk(dir);
  return out;
}

/** App code and scripts: everything the fetch rules apply to. */
export function loadFetchScopeFiles(root = repoRoot): SourceFile[] {
  return [...loadSourceFiles("src", root), ...loadSourceFiles("scripts", root)];
}

export const PROVIDERS_DIR = "src/lib/providers/";
/** scripts/gtfs/ is an offline job that downloads GTFS feeds once. It is not app traffic. */
export const GTFS_SCRIPTS_DIR = "scripts/gtfs/";
export const FETCH_ALLOWED_DIRS = [PROVIDERS_DIR, GTFS_SCRIPTS_DIR];

function mayFetch(filePath: string): boolean {
  return FETCH_ALLOWED_DIRS.some((dir) => filePath.startsWith(dir));
}

// Rule 5: fetch is only allowed in src/lib/providers/ and the offline scripts/gtfs/ job.
const FETCH_CALL = /\bfetch\s*\(/g;

export function findFetchOutsideProviders(files: SourceFile[]): string[] {
  return files
    .filter((file) => !mayFetch(file.path))
    .filter((file) => new RegExp(FETCH_CALL.source).test(file.text))
    .map((file) => `${file.path}: calls fetch outside ${FETCH_ALLOWED_DIRS.join(" and ")}`);
}

// Rule 2: never fetch listing sites that forbid scraping.
export const BANNED_SITES = [
  "zillow",
  "craigslist",
  "airbnb",
  "furnishedfinder",
  "zumper",
  "facebook",
] as const;

/** Any mention inside a fetch call's arguments. Short Facebook link domains count too. */
const BANNED_IN_ARGS = new RegExp(`${BANNED_SITES.join("|")}|\\bfb\\.(?:com|me)\\b`, "i");

/**
 * A banned host name, such as www.zillow.com or m.facebook.com. The lookbehind skips email
 * addresses like noreply@mail.craigslist.org, which are not URLs anyone fetches.
 */
const TLD = "(?:com|net|org|co|io|me|app|us|info)";
const BANNED_HOST = new RegExp(
  `(?<![@\\w.-])(?:[a-z0-9-]+\\.)*(?:(?:${BANNED_SITES.join("|")})\\.${TLD}|fb\\.(?:com|me))\\b`,
  "i",
);

/** Text of a call's arguments, from just after the opening parenthesis to its match. */
function callArguments(text: string, openParen: number): string {
  let depth = 1;
  for (let i = openParen + 1; i < text.length && i < openParen + 4000; i += 1) {
    const char = text[i];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return text.slice(openParen + 1, i);
  }
  return text.slice(openParen + 1, openParen + 4000);
}

export function findBannedFetches(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(FETCH_CALL)) {
      const args = callArguments(file.text, match.index + match[0].length - 1);
      if (BANNED_IN_ARGS.test(args)) {
        violations.push(`${file.path}: fetch call mentions a banned site`);
      }
    }
    // Providers and the GTFS job are the only fetchers, so no banned host may appear in them.
    if (mayFetch(file.path) && BANNED_HOST.test(file.text)) {
      violations.push(`${file.path}: fetching code references a banned site host`);
    }
  }
  return violations;
}

// Rule 6: client components never read process.env.
const USE_CLIENT = /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/;
const PROCESS_ENV = /\bprocess\s*(?:\.\s*env\b|\[\s*["']env["']\s*\])/;

export function findClientEnvReads(files: SourceFile[]): string[] {
  return files
    .filter((file) => USE_CLIENT.test(file.text) && PROCESS_ENV.test(file.text))
    .map((file) => `${file.path}: "use client" file reads process.env`);
}

// Rule 3: no tool that can send, email, reply, pay or purchase.
const FORBIDDEN_TOOL_WORDS = /send|email|reply|pay|purchase/i;

export function findForbiddenToolNames(names: string[]): string[] {
  return names
    .filter((name) => FORBIDDEN_TOOL_WORDS.test(name))
    .map((name) => `tool "${name}" contains a forbidden word (send, email, reply, pay, purchase)`);
}

/** Names from a registry that is either an array of tools or an object keyed by tool name. */
export function toolNames(registry: unknown): string[] {
  const nameOf = (value: unknown): string[] =>
    value && typeof value === "object" && "name" in value && typeof value.name === "string"
      ? [value.name]
      : [];
  if (Array.isArray(registry)) return registry.flatMap(nameOf);
  if (registry && typeof registry === "object") {
    return [...new Set([...Object.keys(registry), ...Object.values(registry).flatMap(nameOf)])];
  }
  return [];
}

// Rule 3: Gmail access is read-only.
const GMAIL_AUTH_SCOPE = /googleapis\.com\/auth\/(gmail[\w.]*)/g;
const GMAIL_FULL_ACCESS = /["'`]https:\/\/mail\.google\.com\/?["'`]/;
const GMAIL_SCOPE_SUFFIX =
  /\bgmail\.(?:modify|send|compose|insert|labels|metadata|settings\.\w+|addons\.[\w.]+)\b/;

export function findNonReadonlyGmailScopes(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(GMAIL_AUTH_SCOPE)) {
      if (match[1] !== "gmail.readonly") {
        violations.push(`${file.path}: Gmail scope "${match[1]}" is not gmail.readonly`);
      }
    }
    if (GMAIL_FULL_ACCESS.test(file.text)) {
      violations.push(`${file.path}: full-access Gmail scope https://mail.google.com/`);
    }
    // Shorthand names such as "gmail.send". Full scope URLs were already reported above.
    const bare = file.text.replace(GMAIL_AUTH_SCOPE, "").match(GMAIL_SCOPE_SUFFIX);
    if (bare) violations.push(`${file.path}: Gmail scope "${bare[0]}" is not gmail.readonly`);
  }
  return violations;
}
