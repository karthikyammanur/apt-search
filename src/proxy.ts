import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./app/login/session";

// Password gate. Next 16 calls this file "proxy" (it replaces middleware.ts).
// Fails closed: with no APP_PASSWORD set, nothing but /login is reachable.
export async function proxy(request: NextRequest) {
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

// Everything except /login, Next's static files and common image assets.
export const config = {
  matcher: [
    "/((?!login$|login/|_next/static|_next/image|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
