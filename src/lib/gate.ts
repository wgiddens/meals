/**
 * The sign-in gate's decisions, as pure functions of the environment.
 *
 * Kept apart from src/lib/member.ts, with no Better Auth, database or
 * Next.js request APIs, so checks can call them with any environment.
 */

type Env = Readonly<Record<string, string | undefined>>;

/**
 * How the app decides who is signed in:
 *   "dev-owner"  not production and no Google client: everyone is the
 *                built-in dev owner, so `npm run dev` needs no setup;
 *   "sign-in"    a Better Auth session is required;
 *   "closed"     production with Google or BETTER_AUTH_SECRET missing:
 *                nothing is accessible until the configuration is complete.
 *
 * NODE_ENV is checked first, before any sign-in configuration is read, so a
 * production build can never reach the dev owner whatever else is set.
 */
export type GateMode = "dev-owner" | "sign-in" | "closed";

function isSet(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

/** Both halves of the Google client, as googleConfig() in src/lib/auth.ts requires. */
function googleConfigured(env: Env): boolean {
  return isSet(env.GOOGLE_CLIENT_ID) && isSet(env.GOOGLE_CLIENT_SECRET);
}

export function gateMode(env: Env): GateMode {
  if (env.NODE_ENV === "production") {
    return googleConfigured(env) && isSet(env.BETTER_AUTH_SECRET) ? "sign-in" : "closed";
  }
  return googleConfigured(env) ? "sign-in" : "dev-owner";
}

/** True only outside production with no Google client configured. */
export function devOwnerAllowed(env: Env): boolean {
  return gateMode(env) === "dev-owner";
}

/** Where signed-out visitors are sent. */
export const SIGN_IN_PATH = "/sign-in";

/**
 * Only allow redirecting back to a path on this site. Rejects anything a
 * browser could read as another host: `//evil.example`, `/\evil.example`
 * (browsers treat `\` as `/`), absolute URLs, and control characters. The
 * URL parse against a fixed origin is the final word. The sign-in page itself
 * is never a destination, so a `next` cannot loop back to it.
 */
export function safeReturnPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  try {
    // Check the raw and the once-decoded form so `%5C` cannot smuggle a backslash.
    const unsafe = /[\\\u0000-\u001f\u007f]/;
    if (unsafe.test(next) || unsafe.test(decodeURIComponent(next))) return "/";
    const url = new URL(next, "http://x");
    if (url.origin !== "http://x" || url.pathname + url.search + url.hash !== next) return "/";
    if (url.pathname === SIGN_IN_PATH || url.pathname.startsWith(`${SIGN_IN_PATH}/`)) return "/";
  } catch {
    return "/";
  }
  return next;
}
