import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { z } from "zod";

/** Incremental RFC 4180 parser, including quoted newlines and escaped quotes. */
export async function* csvRecords(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  let row: string[] = [],
    cell = "",
    quoted = false,
    afterQuote = false;
  for await (const chunk of chunks) {
    for (const char of chunk) {
      if (quoted) {
        if (char === '"') {
          quoted = false;
          afterQuote = true;
        } else cell += char;
      } else if (afterQuote && char === '"') {
        cell += '"';
        quoted = true;
        afterQuote = false;
      } else if (char === "," || char === "\n") {
        row.push(cell);
        cell = "";
        afterQuote = false;
        if (char === "\n") {
          yield row;
          row = [];
        }
      } else if (char === "\r") {
        continue;
      } else if (char === '"' && cell === "" && !afterQuote) {
        quoted = true;
      } else {
        if (afterQuote) throw new Error("Invalid CSV after closing quote");
        cell += char;
      }
    }
  }
  if (quoted) throw new Error("Unterminated CSV quote");
  if (cell !== "" || row.length) {
    row.push(cell);
    yield row;
  }
}

export async function* rows<T>(
  file: string,
  schema: z.ZodType<T>,
  optional = false,
): AsyncGenerator<T> {
  try {
    await access(file);
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  let headers: string[] | undefined;
  for await (const cells of csvRecords(createReadStream(file, { encoding: "utf8" }))) {
    if (cells.length === 1 && cells[0] === "") continue;
    if (!headers) {
      headers = cells.map((s) => s.replace(/^\uFEFF/, ""));
      continue;
    }
    if (cells.length !== headers.length) throw new Error(`CSV column count mismatch: ${file}`);
    yield schema.parse(Object.fromEntries(headers.map((key, i) => [key, cells[i]])));
  }
  if (!headers) throw new Error(`Empty GTFS file: ${file}`);
}
