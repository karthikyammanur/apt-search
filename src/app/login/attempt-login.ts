// The whole login decision in one place, free of Next.js APIs so tests can call it directly.

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/db";
import { checkLoginGate, clearFailedLogins, recordFailedLogin } from "@/db/login-attempts";

export type LoginDecision = { ok: true } | { ok: false; error: string };

const passwordSchema = z.string().min(1);

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function passwordsMatch(given: string, expected: string): boolean {
  // Hash both sides so the comparison is constant time and length does not leak.
  return timingSafeEqual(digest(given), digest(expected));
}

export async function attemptLogin(
  db: Db,
  input: { password: unknown; expected: string; clientKey: string; now?: Date },
): Promise<LoginDecision> {
  const { password, expected, clientKey, now = new Date() } = input;

  if (!expected) {
    return { ok: false, error: "Login is not set up. Set APP_PASSWORD on the server." };
  }

  // Checked before the password, so a locked-out client learns nothing about a guess.
  const gate = await checkLoginGate(db, clientKey, now);
  if (!gate.allowed) {
    const minutes = Math.ceil(gate.retryAfterSeconds / 60);
    return {
      ok: false,
      error: `Too many wrong passwords. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    };
  }

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success || !passwordsMatch(parsed.data, expected)) {
    await recordFailedLogin(db, clientKey, now);
    return { ok: false, error: "Wrong password." };
  }

  await clearFailedLogins(db, clientKey);
  return { ok: true };
}
