import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "@/app/login/session";

export async function requireLogin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token, process.env.APP_PASSWORD ?? ""))) redirect("/login");
}
