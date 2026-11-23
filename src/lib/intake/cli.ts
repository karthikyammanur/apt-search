// `npm run intake:once`: run the automatic channels once against the local database and print a
// short summary per listing. Uses real free quota (the model, SUPost, and the map APIs for any
// listing with a street address), so run it sparingly.
//
//   npm run intake:once -- [--channel supost|gmail|rentcast|all] [--limit 15] [--force]

import { loadEnvConfig } from "@next/env";
import { fmtCents } from "@/lib/domain";
import { createDeps } from "./deps";
import { runAutomaticChannels, type AutomaticChannel } from "./run";

loadEnvConfig(process.cwd());

const CHANNEL_NAMES: Record<string, AutomaticChannel[]> = {
  supost: ["supost"],
  gmail: ["gmail_alerts"],
  rentcast: ["rentcast"],
  all: ["supost", "gmail_alerts", "rentcast"],
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<number> {
  const channels = CHANNEL_NAMES[arg("channel") ?? "all"];
  if (!channels) {
    console.error("Unknown --channel. Use supost, gmail, rentcast or all.");
    return 2;
  }
  const limit = Number(arg("limit") ?? 15);
  if (!Number.isInteger(limit) || limit < 1) {
    console.error("--limit must be a positive whole number.");
    return 2;
  }

  let deps;
  try {
    deps = await createDeps();
  } catch {
    console.error("Could not read settings. Run npm run db:migrate and npm run db:seed first.");
    return 1;
  }

  const summaries = await runAutomaticChannels(deps, { channels, limit, force: process.argv.includes("--force") });
  let failed = false;
  for (const summary of summaries) {
    console.log(`\n== ${summary.channel} ==`);
    if (summary.skipped) {
      console.log(`skipped: ${summary.skipped}`);
      continue;
    }
    const counts = new Map<string, number>();
    for (const o of summary.outcomes) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    console.log(
      `seen ${summary.seen}, new ${summary.newCount}, deferred ${summary.deferred}` +
        (counts.size ? ` (${[...counts].map(([k, v]) => `${k} ${v}`).join(", ")})` : ""),
    );
    if (summary.error && summary.deferred === 0) {
      failed = true;
      console.log(`error: ${summary.error}`);
    }
    for (const warning of summary.warnings) console.log(`warning: ${warning}`);
    for (const o of summary.outcomes) {
      if (o.status !== "stored" && o.status !== "merged" && o.status !== "roommate_lead") continue;
      const cost = o.allInMonthlyCents === null ? "Unknown" : fmtCents(o.allInMonthlyCents);
      const commute = o.commuteMinutes === null ? "Unknown" : `${o.commuteMinutes} min`;
      console.log(
        [`#${o.listingId ?? "-"}`, o.source, o.type ?? "type Unknown", `all-in ${cost}`, `commute ${commute}`, `bucket ${o.bucket ?? o.status}`].join(" | ") +
          (o.note ? `  (${o.note})` : ""),
      );
    }
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  () => {
    console.error("intake:once failed unexpectedly.");
    process.exit(1);
  },
);
