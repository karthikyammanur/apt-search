import { z } from "zod";
import { cachedFetch, failure, query, TTL, type Result, type Transport } from "./core";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const tokenSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().min(60),
    token_type: z.string().regex(/^Bearer$/i),
    scope: z.string().optional(),
  })
  .refine((v) => !v.scope || v.scope.split(/\s+/).every((s) => s === GMAIL_SCOPE));
export const gmailListSchema = z.object({
  messages: z
    .array(z.object({ id: z.string().min(1), threadId: z.string().optional() }))
    .optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});
const headerSchema = z.object({ name: z.string(), value: z.string() });
type Part = {
  mimeType?: string;
  headers?: z.infer<typeof headerSchema>[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: Part[];
};
export const gmailPartSchema: z.ZodType<Part> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: z
      .object({
        data: z.string().optional(),
        attachmentId: z.string().optional(),
        size: z.number().int().nonnegative().optional(),
      })
      .optional(),
    parts: z.array(gmailPartSchema).optional(),
  }),
);
export const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  internalDate: z.string().optional(),
  payload: gmailPartSchema,
});
const attachmentSchema = z.object({ data: z.string(), size: z.number().int().nonnegative() });
export type GmailMessage = {
  id: string;
  headers: z.infer<typeof headerSchema>[];
  plainText: string | null;
  html: string | null;
};
export function createGmail(
  options: {
    transport?: Transport;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
  } = {},
) {
  const transport = options.transport ?? cachedFetch;
  async function token() {
    const clientId = (options.clientId ?? process.env.GMAIL_CLIENT_ID ?? "").trim();
    const clientSecret = (options.clientSecret ?? process.env.GMAIL_CLIENT_SECRET ?? "").trim();
    const refreshToken = (options.refreshToken ?? process.env.GMAIL_REFRESH_TOKEN ?? "").trim();
    if (!clientId || !clientSecret || !refreshToken) return failure("disabled");
    return transport(
      "gmail",
      {
        url: "https://oauth2.googleapis.com/token",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }).toString(),
        },
        schema: tokenSchema,
        memoryOnly: true,
      },
      30_000,
    );
  }
  async function read<T>(url: string, schema: z.ZodType<T>, ttl: number): Promise<Result<T>> {
    const auth = await token();
    if (!auth.ok) return auth;
    return transport(
      "gmail",
      { url, init: { headers: { Authorization: `Bearer ${auth.data.access_token}` } }, schema },
      ttl,
    );
  }
  return {
    listMessages(since: string, pageToken?: string) {
      if (
        !z.iso.datetime({ offset: true }).safeParse(since).success ||
        (pageToken !== undefined && !z.string().min(1).max(2000).safeParse(pageToken).success)
      )
        return Promise.resolve(failure("bad_response"));
      return read(
        query("https://gmail.googleapis.com/gmail/v1/users/me/messages", {
          q: `label:housing-alerts after:${Math.floor(Date.parse(since) / 1000)}`,
          maxResults: 100,
          ...(pageToken ? { pageToken } : {}),
        }),
        gmailListSchema,
        TTL.gmail,
      );
    },
    async getMessage(id: string): Promise<Result<GmailMessage>> {
      if (
        !z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .safeParse(id).success
      )
        return failure("bad_response");
      const result = await read(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
        gmailMessageSchema,
        TTL.gmail,
      );
      if (!result.ok) return result;
      const plain: string[] = [],
        html: string[] = [];
      async function visit(part: Part, depth: number): Promise<Result<true>> {
        if (depth > 30) return failure("bad_response");
        if (part.mimeType === "text/plain" || part.mimeType === "text/html") {
          let data = part.body?.data;
          if (data === undefined && part.body?.attachmentId) {
            const attachment = await read(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
              attachmentSchema,
              TTL.gmail,
            );
            if (!attachment.ok) return attachment;
            data = attachment.data.data;
          }
          if (data !== undefined) {
            if (!/^[A-Za-z0-9_\-=]*$/.test(data)) return failure("bad_response");
            (part.mimeType === "text/plain" ? plain : html).push(
              Buffer.from(data, "base64url").toString("utf8"),
            );
          }
        }
        for (const child of part.parts ?? []) {
          const result = await visit(child, depth + 1);
          if (!result.ok) return result;
        }
        return { ok: true, data: true };
      }
      try {
        const visited = await visit(result.data.payload, 0);
        if (!visited.ok) return visited;
        return {
          ok: true,
          data: {
            id: result.data.id,
            headers: result.data.payload.headers ?? [],
            plainText: plain.length ? plain.join("\n") : null,
            html: html.length ? html.join("\n") : null,
          },
        };
      } catch {
        return failure("bad_response");
      }
    },
  };
}
export const gmail = createGmail();
