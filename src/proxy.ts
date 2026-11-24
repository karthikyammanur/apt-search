import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./app/login/session";

// Password gate. Next 16 calls this file "proxy" (it replaces middleware.ts).
// Fails closed: with no APP_PASSWORD set, nothing but /login and the two machine routes is reachable.
//
// /api/capture (browser extension, X-Capture-Token) and /api/cron/* (Vercel Cron, Bearer CRON_SECRET)
// skip the login cookie and check their own secret in the route handler.
export function isMachineRoute(pathname: string): boolean {
  return pathname === "/api/capture" || pathname === "/api/cron" || pathname.startsWith("/api/cron/");
}

export async function proxy(request: NextRequest) {
  // The matcher already skips these paths; this check keeps the gate correct if the matcher changes.
  if (isMachineRoute(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const secret = process.env.APP_PASSWORD ?? "";
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (token && (await verifySession(token, secret))) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

// Everything except /login, the two machine routes, Next's static files and common image assets.
export const config = {
  matcher: [
    "/((?!login$|login/|api/capture$|api/cron$|api/cron/|_next/static|_next/image|favicon\.ico$|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
