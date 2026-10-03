/**
 * Minimal admin authentication for the Data Status page and manual refresh.
 * ADMIN_TOKEN (server env) is exchanged for an HttpOnly, signed, expiring session cookie.
 * Requests may also send `Authorization: Bearer <ADMIN_TOKEN>` (used by external schedulers).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "mmta_admin";
const SESSION_TTL_MS = 8 * 3_600_000;

function secret(): string | null {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_TOKEN;
  return s && s.length >= 16 ? s : null;
}

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length >= 16 && !!secret();
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkAdminToken(candidate: string | null | undefined): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!candidate || !token || token.length < 16) return false;
  return safeEqual(candidate, token);
}

export function issueSession(now = Date.now()): { value: string; maxAgeSeconds: number } {
  const s = secret();
  if (!s) throw new Error("Admin authentication is not configured");
  const exp = now + SESSION_TTL_MS;
  const sig = createHmac("sha256", s).update(`admin:${exp}`).digest("base64url");
  return { value: `${exp}.${sig}`, maxAgeSeconds: SESSION_TTL_MS / 1000 };
}

export function verifySession(value: string | undefined | null, now = Date.now()): boolean {
  const s = secret();
  if (!s || !value) return false;
  const [expStr, sig] = value.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < now) return false;
  const expected = createHmac("sha256", s).update(`admin:${exp}`).digest("base64url");
  return safeEqual(sig, expected);
}

export function isAdminRequest(headers: Headers, cookieValue: string | undefined): boolean {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ") && checkAdminToken(auth.slice(7).trim())) return true;
  return verifySession(cookieValue);
}
