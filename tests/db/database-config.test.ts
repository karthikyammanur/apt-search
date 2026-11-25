// Which database the app opens, for local dev, scripts and a Vercel deployment with the Turso integration.

import { describe, expect, it } from "vitest";
import { DEFAULT_DATABASE_URL, describeDatabaseTarget, resolveDatabaseConfig } from "@/db";

const TURSO = {
  TURSO_DATABASE_URL: "libsql://example-db-org.turso.io",
  TURSO_AUTH_TOKEN: "turso-token",
};

describe("resolveDatabaseConfig", () => {
  it("defaults to the local dev file with no token", () => {
    expect(resolveDatabaseConfig({})).toEqual({ url: DEFAULT_DATABASE_URL, authToken: undefined });
  });

  it("reads DATABASE_URL and DATABASE_AUTH_TOKEN", () => {
    expect(
      resolveDatabaseConfig({ DATABASE_URL: "libsql://mine.turso.io", DATABASE_AUTH_TOKEN: "mine" }),
    ).toEqual({ url: "libsql://mine.turso.io", authToken: "mine" });
  });

  it("reads the names the Vercel Turso integration creates, on production and preview", () => {
    for (const VERCEL_ENV of ["production", "preview", undefined]) {
      expect(resolveDatabaseConfig({ VERCEL: "1", VERCEL_ENV, ...TURSO })).toEqual({
        url: TURSO.TURSO_DATABASE_URL,
        authToken: TURSO.TURSO_AUTH_TOKEN,
      });
    }
  });

  it("prefers DATABASE_* over TURSO_* when both are set", () => {
    expect(
      resolveDatabaseConfig({
        VERCEL: "1",
        VERCEL_ENV: "production",
        DATABASE_URL: "libsql://override.turso.io",
        DATABASE_AUTH_TOKEN: "override",
        ...TURSO,
      }),
    ).toEqual({ url: "libsql://override.turso.io", authToken: "override" });
  });

  it("treats empty strings as unset", () => {
    expect(
      resolveDatabaseConfig({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: "", DATABASE_AUTH_TOKEN: "", ...TURSO }),
    ).toEqual({ url: TURSO.TURSO_DATABASE_URL, authToken: TURSO.TURSO_AUTH_TOKEN });
  });

  it("ignores TURSO_* off Vercel, so a pulled .env.local cannot point local dev at production", () => {
    expect(resolveDatabaseConfig({ ...TURSO })).toEqual({ url: DEFAULT_DATABASE_URL, authToken: undefined });
    expect(resolveDatabaseConfig({ VERCEL: "1", VERCEL_ENV: "development", ...TURSO })).toEqual({
      url: DEFAULT_DATABASE_URL,
      authToken: undefined,
    });
  });
});

describe("describeDatabaseTarget", () => {
  it("shows the host only, never credentials or the query string", () => {
    expect(describeDatabaseTarget("libsql://user:secret@example-db-org.turso.io/?authToken=abc")).toBe(
      "libsql://example-db-org.turso.io",
    );
    expect(describeDatabaseTarget("file:data/dev.db")).toBe("file:data/dev.db");
    expect(describeDatabaseTarget("not a url")).toBe("an unparseable URL");
  });
});
