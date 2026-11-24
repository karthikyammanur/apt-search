// POST /api/chat/e2e-seed: replace the e2e database with the demo data, through the server's own
// connection so the test never writes the SQLite file from a second process. It exists only on
// the e2e server (fake model on, a local file named e2e.db); everywhere else it is a 404.

import { cookies } from "next/headers";
import { getDb } from "@/db";
import { seedDemo } from "@/db/demo";
import { fakeModeEnabled } from "@/lib/agent/fake";
import { getBoard } from "@/lib/queries";
import { SESSION_COOKIE, verifySession } from "@/app/login/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!fakeModeEnabled() || !/(^|[/\\:])e2e\.db$/.test(process.env.DATABASE_URL ?? "")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token, process.env.APP_PASSWORD ?? ""))) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  const db = getDb();
  await seedDemo(db, { reset: true });
  const [pass] = (await getBoard({ bucket: "pass" }, { db })).items;
  return Response.json({ passListingId: pass?.id ?? null });
}
