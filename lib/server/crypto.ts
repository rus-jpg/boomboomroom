import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "./env";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signSession(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export function encodeSessionCookie(token: string): string {
  return `${token}.${signSession(token)}`;
}

export function decodeSessionCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const [token, sig] = raw.split(".");
  if (!token || !sig) return null;
  const expected = signSession(token);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token;
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return sha256(`${sessionSecret()}:${ip}`);
}
