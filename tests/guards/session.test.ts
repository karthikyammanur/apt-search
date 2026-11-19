import { describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_SECONDS, createSession, verifySession } from "@/app/login/session";

const SECRET = "test-secret";
const NOW = Date.UTC(2026, 10, 19);

describe("password gate session token", () => {
  it("accepts a fresh token signed with the same secret", async () => {
    const token = await createSession(SECRET, NOW);
    expect(await verifySession(token, SECRET, NOW + 1000)).toBe(true);
  });

  it("rejects a token signed with a different secret, so a password change signs everyone out", async () => {
    const token = await createSession(SECRET, NOW);
    expect(await verifySession(token, "other-secret", NOW)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createSession(SECRET, NOW);
    const afterExpiry = NOW + (SESSION_MAX_AGE_SECONDS + 1) * 1000;
    expect(await verifySession(token, SECRET, afterExpiry)).toBe(false);
  });

  it("rejects a token whose expiry was extended", async () => {
    const token = await createSession(SECRET, NOW);
    const [expires, signature] = token.split(".");
    const forged = `${Number(expires) + 999999}.${signature}`;
    expect(await verifySession(forged, SECRET, NOW)).toBe(false);
  });

  it("rejects malformed tokens and an empty secret", async () => {
    const token = await createSession(SECRET, NOW);
    for (const bad of ["", "abc", "1.2.3", ".", "x.y", `${token}.extra`]) {
      expect(await verifySession(bad, SECRET, NOW)).toBe(false);
    }
    expect(await verifySession(token, "", NOW)).toBe(false);
  });
});
