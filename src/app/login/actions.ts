"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { attemptLogin } from "./attempt-login";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSession } from "./session";

export type LoginState = { error: string | null };

/**
 * Who is trying. On Vercel the platform sets x-forwarded-for, so a caller cannot spoof it.
 * Per client rather than global, so a stranger guessing cannot lock the owner out.
 */
async function clientKey(): Promise<string> {
  const incoming = await headers();
  const forwarded = incoming.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || incoming.get("x-real-ip") || "unknown").slice(0, 64);
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const expected = process.env.APP_PASSWORD ?? "";

  let decision;
  try {
    decision = await attemptLogin(getDb(), {
      password: formData.get("password"),
      expected,
      clientKey: await clientKey(),
    });
  } catch (error) {
    // Most likely the database is unreachable or not migrated. Fail closed.
    console.error("Login check failed:", error instanceof Error ? error.message : "unknown error");
    return { error: "Login is temporarily unavailable. Try again shortly." };
  }

  if (!decision.ok) return { error: decision.error };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSession(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/");
}
