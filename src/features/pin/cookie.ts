import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The PIN session cookie holds a random token and its signature. The database keeps only the token's
 * hash, so neither a copy of the table nor a changed cookie gets anyone in.
 */

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A signing key for this one purpose, worked out from a server-only secret, so no new secret has to be managed. */
export function cookieSigningKey(serverSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", serverSecret, "el-lorito", "pin-session-cookie-v1", 32));
}

function signature(token: string, key: Buffer): string {
  return createHmac("sha256", key).update(token).digest("base64url");
}

export function signToken(token: string, key: Buffer): string {
  return `${token}.${signature(token, key)}`;
}

/** The token from a cookie value, or null when it was changed or signed with another key. */
export function verifySignedToken(value: string, key: Buffer): string | null {
  const [token, given, extra] = value.split(".");
  if (!token || !given || extra !== undefined) return null;
  const expected = Buffer.from(signature(token, key));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? token : null;
}
