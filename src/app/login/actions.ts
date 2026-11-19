"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSession } from "./session";

export type LoginState = { error: string | null };

const formSchema = z.object({ password: z.string().min(1) });

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function passwordsMatch(given: string, expected: string): boolean {
  // Hash both sides so the comparison is constant time and length does not leak.
  return timingSafeEqual(digest(given), digest(expected));
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected) {
    return { error: "Login is not set up. Set APP_PASSWORD on the server." };
  }

  const parsed = formSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success || !passwordsMatch(parsed.data.password, expected)) {
    return { error: "Wrong password." };
  }

  const token = await createSession(expected);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/");
}
