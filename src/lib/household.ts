import { cookies } from "next/headers";

/**
 * The household passcode gate. One shared passcode (HOUSEHOLD_PASSCODE) lets
 * the family into the web app until real accounts exist. When the variable is
 * unset the app is open, so local development needs no setup.
 *
 * A signed-in browser holds a cookie with an HMAC-signed token. The signing
 * key is derived from the passcode itself, so there is no second secret to
 * manage, and changing the passcode signs everyone out. Only Web Crypto is
 * used so the same code runs in proxy.ts, Server Actions and pages.
 */

export const SESSION_COOKIE = "meals_household";
/** About a year, so family phones stay signed in. */
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const encoder = new TextEncoder();

export function isGateEnabled(): boolean {
  return Boolean(process.env.HOUSEHOLD_PASSCODE);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(digest);
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings without leaking where they differ. */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  // Hash both sides first so the comparison is fixed-length regardless of input.
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export async function checkPasscode(input: string): Promise<boolean> {
  const expected = process.env.HOUSEHOLD_PASSCODE;
  if (!expected) return true;
  return constantTimeEqual(input.trim(), expected);
}

async function signingKey(): Promise<CryptoKey> {
  const passcode = process.env.HOUSEHOLD_PASSCODE ?? "";
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`meals-household-session\u0000${passcode}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

async function sign(issuedAt: string): Promise<string> {
  const key = await signingKey();
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(issuedAt)));
}

/** A token is `<issued-at ms>.<hmac hex>`. */
export async function issueSessionToken(): Promise<string> {
  const issuedAt = String(Date.now());
  return `${issuedAt}.${await sign(issuedAt)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature || !/^\d+$/.test(issuedAt)) return false;
  const ageSeconds = (Date.now() - Number(issuedAt)) / 1000;
  if (ageSeconds < 0 || ageSeconds > SESSION_MAX_AGE_SECONDS) return false;
  return constantTimeEqual(signature, await sign(issuedAt));
}

/** True when the gate is off or the current request carries a valid session. */
export async function isSignedIn(): Promise<boolean> {
  const store = await cookies();
  if (!isGateEnabled()) return true;
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * Guard for Server Actions. proxy.ts already turns away unauthenticated page
 * requests, but actions are plain POSTs and must check for themselves.
 */
export async function requireHousehold(): Promise<void> {
  if (!(await isSignedIn())) throw new Error("Sign in to the household first");
}

/**
 * Only allow redirecting back to a path on this site (no `//evil.example`).
 */
export function safeReturnPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (next === "/login" || next.startsWith("/login?")) return "/";
  return next;
}
