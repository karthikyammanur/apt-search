// Signed session token for the single-user password gate.
//
// The token is "<expiresAtSeconds>.<base64url HMAC-SHA256 signature>". The signing key is the
// app password itself (no extra secret to manage), so changing APP_PASSWORD signs everyone out.
// Only Web Crypto is used, so this file runs in both the proxy and server actions.

export const SESSION_COOKIE = "af_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function payload(expiresAt: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`apartment-finder.session.v1.${expiresAt}`);
}

export async function createSession(secret: string, nowMs: number = Date.now()): Promise<string> {
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), payload(expiresAt));
  return `${expiresAt}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySession(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!secret) return false;
  const [expiresPart, signaturePart, ...rest] = token.split(".");
  if (!expiresPart || !signaturePart || rest.length > 0) return false;
  if (!/^\d+$/.test(expiresPart)) return false;
  const expiresAt = Number(expiresPart);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(nowMs / 1000)) return false;
  const signature = fromBase64Url(signaturePart);
  if (!signature) return false;
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", await hmacKey(secret), signature, payload(expiresAt));
}
