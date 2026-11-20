import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCache, getDb, type Db } from "../../db";

export type ProviderError =
  "disabled" | "rate_limited" | "quota_paused" | "not_found" | "network" | "bad_response";
export type Result<T> = { ok: true; data: T } | { ok: false; error: ProviderError };
export const failure = (error: ProviderError): Result<never> => ({ ok: false, error });
export type Provider =
  "google" | "transitland" | "geoapify" | "overpass" | "supost" | "rentcast" | "gmail";
export type Request<T> = {
  url: string;
  init?: RequestInit;
  schema: z.ZodType<T>;
  classify?: (body: unknown, status: number) => ProviderError | undefined;
  memoryOnly?: boolean;
};
export type Transport = <T>(
  provider: Provider,
  request: Request<T>,
  ttl: number,
) => Promise<Result<T>>;
export type ClientOptions = { transport?: Transport; key?: string };
const limits: Record<Provider, number> = {
  google: 60,
  transitland: 10,
  geoapify: 60,
  overpass: 2,
  supost: 30,
  rentcast: 5,
  gmail: 60,
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Only hashes are stored for requests, including credentials and private query strings. */
export function requestHash(request: Request<unknown>): string {
  const url = new URL(request.url);
  url.searchParams.sort();
  return createHash("sha256")
    .update(
      canonical({
        url: url.toString(),
        method: request.init?.method ?? "GET",
        headers: [...new Headers(request.init?.headers).entries()].sort(),
        body: request.init?.body ?? null,
      }),
    )
    .digest("hex");
}

export function createCachedFetch(
  options: { db?: () => Db; fetch?: typeof fetch; now?: () => number } = {},
): Transport {
  const now = options.now ?? Date.now;
  const database = options.db ?? getDb;
  const windows = new Map<Provider, { start: number; count: number; until: number }>();
  const memory = new Map<string, { data: unknown; expires: number }>();
  return async <T>(provider: Provider, request: Request<T>, ttl: number): Promise<Result<T>> => {
    try {
      if (!Number.isFinite(ttl) || ttl < 0) return failure("bad_response");
      const hash = requestHash(request);
      const key = `${provider}:${hash}`;
      const time = now();
      const where = and(eq(apiCache.provider, provider), eq(apiCache.requestHash, hash));
      if (ttl > 0) {
        const saved = request.memoryOnly
          ? memory.get(key)
          : (await database().select().from(apiCache).where(where).limit(1))[0];
        if (saved) {
          const expires = "expires" in saved ? saved.expires : Date.parse(saved.expiresAt);
          if (expires > time) {
            let cached: unknown;
            try {
              cached = "data" in saved ? saved.data : JSON.parse(saved.response);
            } catch {
              cached = undefined;
            }
            const parsed = request.schema.safeParse(cached);
            if (parsed.success) return { ok: true, data: parsed.data };
          }
        }
      }
      const pause = (
        await database()
          .select()
          .from(apiCache)
          .where(and(eq(apiCache.provider, provider), eq(apiCache.requestHash, "quota_pause")))
          .limit(1)
      )[0];
      if (pause && Date.parse(pause.expiresAt) > time) return failure("quota_paused");
      let window = windows.get(provider);
      if (!window || time - window.start >= 60_000) {
        window = { start: time, count: 0, until: window?.until ?? 0 };
        windows.set(provider, window);
      }
      if (window.until > time || window.count >= limits[provider]) return failure("rate_limited");
      for (let attempt = 0; attempt < 2; attempt++) {
        if (window.count >= limits[provider]) return failure("rate_limited");
        window.count++;
        let response: Response;
        try {
          response = await (options.fetch ?? globalThis.fetch)(request.url, {
            ...request.init,
            redirect: "error",
            signal: AbortSignal.timeout(20_000),
          });
        } catch {
          return failure("network");
        }
        if (response.status >= 500 && attempt === 0) {
          await response.body?.cancel();
          continue;
        }
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          window.until = Math.max(
            time + 60_000,
            retry && /^\d+$/.test(retry)
              ? time + Number(retry) * 1000
              : Date.parse(retry ?? "") || 0,
          );
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return failure(response.status === 429 ? "rate_limited" : "bad_response");
        }
        const classified = request.classify?.(body, response.status);
        if (classified === "quota_paused") {
          const expiresAt = new Date(time + 24 * 60 * 60_000).toISOString();
          await database()
            .insert(apiCache)
            .values({
              provider,
              requestHash: "quota_pause",
              response: "null",
              fetchedAt: new Date(time).toISOString(),
              expiresAt,
            })
            .onConflictDoUpdate({
              target: [apiCache.provider, apiCache.requestHash],
              set: { expiresAt },
            });
        }
        if (classified) return failure(classified);
        if (!response.ok)
          return failure(
            response.status === 429
              ? "rate_limited"
              : response.status === 404
                ? "not_found"
                : "bad_response",
          );
        const parsed = request.schema.safeParse(body);
        if (!parsed.success) return failure("bad_response");
        if (ttl > 0) {
          if (request.memoryOnly) memory.set(key, { data: parsed.data, expires: now() + ttl });
          else {
            const values = {
              response: JSON.stringify(parsed.data),
              fetchedAt: new Date(now()).toISOString(),
              expiresAt: new Date(now() + ttl).toISOString(),
            };
            await database()
              .insert(apiCache)
              .values({ provider, requestHash: hash, ...values })
              .onConflictDoUpdate({
                target: [apiCache.provider, apiCache.requestHash],
                set: values,
              });
          }
        }
        return { ok: true, data: parsed.data };
      }
      return failure("bad_response");
    } catch {
      return failure("network");
    }
  };
}

export const cachedFetch = createCachedFetch();
export const TTL = {
  route: 6 * 60 * 60_000,
  geocode: 30 * 24 * 60 * 60_000,
  pois: 24 * 60 * 60_000,
  listings: 5 * 60_000,
  gmail: 60_000,
};
export function query(base: string, params: Record<string, string | number | boolean>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}
export async function mapped<A, B>(
  result: Promise<Result<A>>,
  map: (value: A) => B | undefined,
): Promise<Result<B>> {
  try {
    const value = await result;
    if (!value.ok) return value;
    const data = map(value.data);
    return data === undefined ? failure("not_found") : { ok: true, data };
  } catch {
    return failure("bad_response");
  }
}
