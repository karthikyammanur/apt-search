import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { rentcastAccessReason } from "../src/lib/providers/rentcast";
import settings from "../config/settings.example.json";
import {
  createCachedFetch,
  createGoogle,
  createTransitland,
  createGeoapify,
  createOverpass,
  createSupost,
  createRentcast,
  createGmail,
  type Transport,
  type Result,
  type Coordinates,
} from "../src/lib/providers";

loadEnvConfig(process.cwd());
const record = process.argv.includes("--record");
const live = createCachedFetch();
let fixtureName = "";
// Record validated contracts only. Never record OAuth tokens or mailbox content.
const transport: Transport = async (provider, request) => {
  const result = await live(
    provider,
    {
      ...request,
      classify: (body, status) => {
        if (provider === "rentcast") {
          const reason = rentcastAccessReason(body, status);
          if (reason) console.log(`rentcast: disabled (${reason})`);
        }
        return request.classify?.(body, status);
      },
      diagnose:
        provider === "rentcast" || provider === "overpass"
          ? (details) =>
              console.log(
                `${provider} diagnostic: ${JSON.stringify({ endpoint: new URL(request.url).hostname, ...details })}`,
              )
          : undefined,
    },
    0,
  );
  if (record && result.ok && provider !== "gmail") {
    let data: unknown = result.data;
    if (provider === "supost") {
      const parsed = z
        .object({
          listings: z.array(
            z.object({ category: z.string().nullable(), stanford_verified: z.boolean() }),
          ),
          next_cursor: z.string().nullable(),
        })
        .parse(data);
      data = {
        listings: parsed.listings.map((listing, index) => ({
          ...listing,
          id: index + 1,
          title: "Sanitized housing listing",
          price: null,
          created_at: null,
          url: `https://supost.com/post/example-${index + 1}`,
          poster_email_domain: null,
        })),
        next_cursor: null,
      };
    }
    if (provider === "rentcast")
      data = z
        .array(
          z.object({
            id: z.string(),
            price: z.number().nullable().optional(),
            status: z.string().optional(),
          }),
        )
        .parse(data)
        .map((item, i) => ({ ...item, id: `example-${i}`, formattedAddress: "Example address" }));
    await mkdir("tests/fixtures/providers", { recursive: true });
    await writeFile(
      `tests/fixtures/providers/${fixtureName}.json`,
      JSON.stringify(data, null, 2) + "\n",
    );
  }
  return result;
};

const google = createGoogle({ transport });
const geoapify = createGeoapify({ transport });
const transitland = createTransitland({ transport });
const overpass = createOverpass({ transport });
const supost = createSupost({ transport });
const rentcast = createRentcast({ transport });
const gmail = createGmail({ transport });
async function run<T>(name: string, action: () => Promise<Result<T>>): Promise<Result<T>> {
  fixtureName = name;
  try {
    const result = await action();
    console.log(`${name}: ${result.ok ? "ok" : result.error}`);
    return result;
  } catch {
    console.log(`${name}: error (runner failed)`);
    return { ok: false, error: "network" };
  }
}
async function main() {
  const address = z.string().min(1).parse(settings.officeAddress);
  const geocoded = await run("google-geocode", () => google.geocode(address));
  const backup = await run("geoapify-geocode", () => geoapify.geocode(address));
  const to: Coordinates = geocoded.ok
    ? geocoded.data
    : backup.ok
      ? backup.data
      : { lat: 37.4447, lng: -122.1609 };
  if (!geocoded.ok && !backup.ok) console.log("coordinates: using neutral Palo Alto example point");
  const from = { lat: 37.4292, lng: -122.1423 };
  const date = new Date(Date.now() + 3 * 24 * 60 * 60_000);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const offset =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      timeZoneName: "shortOffset",
    })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value === "GMT-7"
      ? "-07:00"
      : "-08:00";
  const arriveBy = `${day}T08:30:00${offset}`;
  const transit = await run("google-transit", () => google.route(from, to, "TRANSIT", arriveBy));
  console.log(
    `Google Demo Key TRANSIT route: ${transit.ok && transit.data.steps.some((s) => s.mode === "TRANSIT") ? "YES" : "NOT CONFIRMED"}`,
  );
  await run("google-walk", () => google.route(from, to, "WALK"));
  await run("google-bicycle", () => google.route(from, to, "BICYCLE"));
  await run("google-places", () => google.nearby(to));
  await run("transitland", () => transitland.route(from, to, arriveBy));
  await run("geoapify-walk", () => geoapify.route(from, to, "WALK"));
  await run("geoapify-bicycle", () => geoapify.route(from, to, "BICYCLE"));
  await run("overpass", () => overpass.nearby(to));
  await run("supost", () => supost.listings());
  await run("rentcast", () => rentcast.listings(to));
  const messages = await run("gmail-list", () => gmail.listLatestMessages());
  const id = messages.ok ? messages.data.messages?.[0]?.id : undefined;
  if (id) {
    const message = await run("gmail-message", () => gmail.getMessage(id));
    if (message.ok) {
      const header = (name: string) =>
        message.data.headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
      const domain =
        header("from")
          .match(/@([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?=>|\s|$)/i)?.[1]
          ?.toLowerCase() ?? "Unknown";
      console.log(
        `gmail-message: sender domain ${domain}; subject length ${header("subject").length}`,
      );
    }
  } else console.log("gmail-message: skipped (no message ID available)");
}
main().catch(() => {
  console.error("smoke: failed to initialize");
  process.exitCode = 1;
});
