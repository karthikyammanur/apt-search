// Login rate limit: after 5 failed attempts within 15 minutes, reject for 15 minutes.
//
// Attempts live in the database because serverless functions do not share memory. Only failures
// are stored. Rejected attempts during a lockout are not stored, so the lockout does not extend
// itself. A successful login clears that client's failures.

import { desc, eq, lt } from "drizzle-orm";
import type { Db } from "./index";
import { loginAttempts } from "./schema";

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export type LoginGate = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Is this client allowed to try a password right now? */
export async function checkLoginGate(
  db: Db,
  clientKey: string,
  now: Date = new Date(),
): Promise<LoginGate> {
  const recent = await db
    .select({ attemptedAt: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(eq(loginAttempts.clientKey, clientKey))
    .orderBy(desc(loginAttempts.attemptedAt))
    .limit(LOGIN_MAX_FAILURES);

  const newest = recent[0];
  const oldest = recent[recent.length - 1];
  if (recent.length < LOGIN_MAX_FAILURES || !newest || !oldest) return { allowed: true };

  const newestMs = Date.parse(newest.attemptedAt);
  const oldestMs = Date.parse(oldest.attemptedAt);
  // The last 5 failures must all fall inside one 15 minute window to trigger a lockout.
  if (newestMs - oldestMs >= LOGIN_WINDOW_MS) return { allowed: true };

  const lockedUntil = newestMs + LOGIN_LOCKOUT_MS;
  if (now.getTime() >= lockedUntil) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil((lockedUntil - now.getTime()) / 1000) };
}

export async function recordFailedLogin(
  db: Db,
  clientKey: string,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(loginAttempts).values({ clientKey, attemptedAt: now.toISOString() });
  // Keep the table small.
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, new Date(now.getTime() - PRUNE_AFTER_MS).toISOString()));
}

export async function clearFailedLogins(db: Db, clientKey: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.clientKey, clientKey));
}
