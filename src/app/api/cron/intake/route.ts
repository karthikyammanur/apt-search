// GET /api/cron/intake: the daily run of every automatic channel. Vercel Cron calls it with
// "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set in the project. With no secret
// configured, every call is refused.

import { createHash, timingSafeEqual } from "node:crypto";
import { createDeps } from "@/lib/intake/deps";
import { CRON_BUDGET, runAutomaticChannels } from "@/lib/intake/run";

// Vercel Hobby cuts a function off at 300 s (docs/deploy.md). CRON_BUDGET stops new work well before
// that, so a run always finishes, records itself and answers.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const deps = await createDeps();
  const summaries = await runAutomaticChannels(deps, { limit: CRON_BUDGET.perChannel, budget: CRON_BUDGET });
  return Response.json({
    ok: true,
    channels: summaries.map((s) => ({
      channel: s.channel,
      skipped: s.skipped,
      error: s.error,
      seen: s.seen,
      new: s.newCount,
      deferred: s.deferred,
    })),
  });
}
