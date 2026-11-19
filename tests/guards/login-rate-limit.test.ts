import { beforeEach, describe, expect, it } from "vitest";
import { attemptLogin } from "@/app/login/attempt-login";
import { createDb, type Db } from "@/db";
import { LOGIN_MAX_FAILURES, checkLoginGate, recordFailedLogin } from "@/db/login-attempts";
import { runMigrations } from "@/db/run-migrations";
import { loginAttempts } from "@/db/schema";

// After 5 failed attempts in 15 minutes, the client is rejected for 15 minutes.

const T0 = Date.parse("2026-11-19T12:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000);
const RIGHT = "the-right-password";

let db: Db;

beforeEach(async () => {
  db = createDb(":memory:");
  await runMigrations(db);
});

const wrong = (minute: number, clientKey = "203.0.113.7") =>
  attemptLogin(db, { password: "nope", expected: RIGHT, clientKey, now: at(minute) });
const right = (minute: number, clientKey = "203.0.113.7") =>
  attemptLogin(db, { password: RIGHT, expected: RIGHT, clientKey, now: at(minute) });

describe("login rate limit", () => {
  it("allows the right password after four wrong ones", async () => {
    for (const minute of [0, 1, 2, 3]) {
      expect(await wrong(minute)).toEqual({ ok: false, error: "Wrong password." });
    }
    expect(await right(4)).toEqual({ ok: true });
  });

  it("locks on the fifth wrong password and rejects even the right one for 15 minutes", async () => {
    for (const minute of [0, 1, 2, 3, 4]) await wrong(minute);

    const locked = await right(5);
    expect(locked).toMatchObject({ ok: false });
    expect(locked.ok === false && locked.error).toContain("Too many wrong passwords");
    expect(locked.ok === false && locked.error).toContain("14 minutes");

    expect((await right(18.9)).ok).toBe(false);
    expect(await right(19)).toEqual({ ok: true });
  });

  it("does not extend the lockout when the client keeps trying", async () => {
    for (const minute of [0, 1, 2, 3, 4]) await wrong(minute);
    for (const minute of [5, 8, 12, 15, 18]) expect((await wrong(minute)).ok).toBe(false);
    expect(await right(19)).toEqual({ ok: true });
  });

  it("does not lock when the failures are spread over more than 15 minutes", async () => {
    for (const minute of [0, 4, 8, 12, 16]) await wrong(minute);
    expect(await right(17)).toEqual({ ok: true });
  });

  it("locks again after five more wrong passwords once a lockout has ended", async () => {
    for (const minute of [0, 1, 2, 3, 4]) await wrong(minute);
    for (const minute of [19, 20, 21, 22, 23]) {
      expect(await wrong(minute)).toEqual({ ok: false, error: "Wrong password." });
    }
    expect((await right(24)).ok).toBe(false);
  });

  it("clears earlier failures after a successful login", async () => {
    for (const minute of [0, 1, 2, 3]) await wrong(minute);
    expect(await right(4)).toEqual({ ok: true });
    for (const minute of [5, 6, 7, 8]) await wrong(minute);
    expect(await right(9)).toEqual({ ok: true });
  });

  it("tracks each client separately", async () => {
    for (const minute of [0, 1, 2, 3, 4]) await wrong(minute, "203.0.113.7");
    expect((await right(5, "203.0.113.7")).ok).toBe(false);
    expect(await right(5, "198.51.100.9")).toEqual({ ok: true });
  });

  it("stays shut when APP_PASSWORD is not set, without touching the database", async () => {
    const result = await attemptLogin(db, {
      password: "anything",
      expected: "",
      clientKey: "203.0.113.7",
      now: at(0),
    });
    expect(result).toEqual({
      ok: false,
      error: "Login is not set up. Set APP_PASSWORD on the server.",
    });
    expect(await db.select().from(loginAttempts)).toEqual([]);
  });

  it("treats an empty or missing password as a failed attempt", async () => {
    for (const password of ["", null, undefined, 42]) {
      const result = await attemptLogin(db, {
        password,
        expected: RIGHT,
        clientKey: "203.0.113.7",
        now: at(0),
      });
      expect(result).toEqual({ ok: false, error: "Wrong password." });
    }
    expect(await db.select().from(loginAttempts)).toHaveLength(4);
  });
});

describe("login gate storage", () => {
  it("reports how long a locked client must wait", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) await recordFailedLogin(db, "k", at(i));
    expect(await checkLoginGate(db, "k", at(5))).toEqual({
      allowed: false,
      retryAfterSeconds: 840,
    });
    expect(await checkLoginGate(db, "k", at(19))).toEqual({ allowed: true });
  });

  it("drops attempts older than a day", async () => {
    await recordFailedLogin(db, "k", at(0));
    await recordFailedLogin(db, "k", at(25 * 60));
    expect(await db.select().from(loginAttempts)).toHaveLength(1);
  });
});
