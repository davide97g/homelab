import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const COOKIE = "hub_session";

/** Sessions are a signed timestamp, not a stored record. Copied from
 *  mediarr-dash unchanged except the cookie name.
 *
 *
 *  One user, one password, no database: the cookie carries its own expiry and an
 *  HMAC over it. Rotating SESSION_SECRET invalidates every cookie, which is the
 *  only logout-everywhere that is needed here. */
const secret = config.sessionSecret || randomBytes(32).toString("hex");

function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string): boolean {
  if (!config.password) return false;
  return safeEqual(candidate, config.password);
}

export function issue(): string {
  const expires = Date.now() + config.sessionDays * 86400_000;
  const payload = String(expires);
  return `${payload}.${sign(payload)}`;
}

export function verify(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqual(mac, sign(payload))) return false;
  const expires = Number(payload);
  return Number.isFinite(expires) && expires > Date.now();
}

export function cookieHeader(token: string | null): string {
  const parts = [
    `${COOKIE}=${token ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    token ? `Max-Age=${config.sessionDays * 86400}` : "Max-Age=0",
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) return rest.join("=");
  }
  return undefined;
}
