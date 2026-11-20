import { createReadStream, closeSync, openSync, writeSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { Unzip, UnzipInflate } from "fflate";
import { z } from "zod";

export const FEEDS = ["511", "marguerite"] as const;
const TABLES = new Set([
  "stops.txt",
  "routes.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "frequencies.txt",
]);

export async function extract(zip: string, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const handles = new Set<number>();
  const seen = new Set<string>();
  const unzip = new Unzip((file) => {
    if (!TABLES.has(file.name)) return;
    if (seen.has(file.name)) throw new Error("Duplicate GTFS ZIP member");
    seen.add(file.name);
    const fd = openSync(path.join(directory, file.name), "w");
    handles.add(fd);
    file.ondata = (error, data, final) => {
      if (error) throw error;
      let offset = 0;
      while (offset < data.length) offset += writeSync(fd, data, offset);
      if (final) {
        closeSync(fd);
        handles.delete(fd);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of createReadStream(zip, { highWaterMark: 64 * 1024 }))
      unzip.push(chunk);
    unzip.push(new Uint8Array(), true);
    if (handles.size) throw new Error("Truncated GTFS archive");
    for (const required of ["stops.txt", "routes.txt", "trips.txt", "stop_times.txt"]) {
      if (!seen.has(required)) throw new Error(`Missing ${required} in GTFS archive`);
    }
    if (!seen.has("calendar.txt") && !seen.has("calendar_dates.txt"))
      throw new Error("Missing GTFS calendars");
  } finally {
    for (const fd of handles) closeSync(fd);
  }
}

export async function download(feed: (typeof FEEDS)[number], root = "data/gtfs"): Promise<string> {
  await mkdir(root, { recursive: true });
  const zip = path.join(root, `${feed}.zip`);
  const cached = await stat(zip).catch(() => null);
  if (cached && cached.size > 0 && Date.now() - cached.mtimeMs < 7 * 86400000) {
    console.log(`${feed}: using ZIP cached less than 7 days ago`);
    return zip;
  }
  const url =
    feed === "511"
      ? new URL("https://api.511.org/transit/datafeeds?operator_id=RG")
      : new URL("https://transportation-forms.stanford.edu/google/google_transit.zip");
  if (feed === "511") {
    const token = z.string().trim().min(1).safeParse(process.env.API_511_TOKEN);
    if (!token.success) throw new Error("Set API_511_TOKEN in the shell environment");
    url.searchParams.set("api_key", token.data);
  }
  const temp = `${zip}.part`;
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    } catch {
      throw new Error(`${feed}: download failed (URL and credentials omitted)`);
    }
    if (!response.ok || !response.body)
      throw new Error(`${feed}: download HTTP ${response.status}`);
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(temp),
    );
    await extract(temp, path.join(root, `${feed}-validation`));
    await rename(temp, zip);
    console.log(`${feed}: downloaded and validated`);
    return zip;
  } finally {
    await rm(temp, { force: true });
    await rm(path.join(root, `${feed}-validation`), { recursive: true, force: true });
  }
}
