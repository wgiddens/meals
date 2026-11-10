import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { getDb, schema, type Db } from "@/db";
import { userRoles, type Role } from "@/db/schema";
import { completeSignUp, signUpRole } from "@/lib/family";

/**
 * Accounts and sign-in, provided by Better Auth and stored in our own
 * Postgres through Drizzle.
 *
 * The instance is built on first use rather than at module load, for the same
 * reason as getDb(): the database handle is async and, inside Next.js, only
 * exists once a request has arrived. Never call getAuth() at module scope.
 */

/** 90 days, so a family phone stays signed in. */
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
/** Push the expiry forward at most once a day while the session is in use. */
const SESSION_REFRESH_SECONDS = 24 * 60 * 60;

/** Only for local development and checks. Production must set its own. */
const DEVELOPMENT_SECRET = "meals-development-secret-do-not-use-in-production";

function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is not set. Sign-in is disabled until it is.");
  }
  return DEVELOPMENT_SECRET;
}

/** Google sign-in is offered only when both halves of the client are set. */
export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The origin of a configured URL, or null when it is unset or not http(s). */
function originOf(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The fixed address Google sends every sign-in back to when sign-in runs
 * through the OAuth proxy (OAUTH_PROXY_URL), as an origin. Null when unset,
 * which turns the proxy off: every deployment then talks to Google directly.
 */
export function oauthProxyOrigin(env: Env = process.env): string | null {
  return originOf(env.OAUTH_PROXY_URL);
}

/**
 * The origins Better Auth trusts besides its own BETTER_AUTH_URL (which it
 * always trusts): where sign-in may send people back to, and which pages may
 * call its endpoints. Kept to this project's own addresses, never a pattern
 * such as `*.vercel.app` that anyone's deployment could match:
 *
 *   - outside production, localhost and 127.0.0.1 on any port;
 *   - on a Vercel preview, that deployment's own two addresses (VERCEL_URL,
 *     the per-deployment one, and VERCEL_BRANCH_URL, the per-branch one),
 *     which Vercel sets and a request cannot change;
 *   - the OAuth proxy's fixed address, which is ours too.
 *
 * This is what keeps the OAuth proxy from being an open redirect. The proxy
 * deployment sends people on to the address sealed in the sign-in's state,
 * and only a deployment holding the shared secret can seal one. That
 * deployment first checks the address against this list, so the return trip
 * can only ever lead back to the deployment where sign-in started.
 */
export function trustedOrigins(env: Env = process.env): string[] {
  const origins = new Set<string>();
  if (env.NODE_ENV !== "production") {
    origins.add("http://localhost:*");
    origins.add("http://127.0.0.1:*");
  }
  if (env.VERCEL_ENV === "preview") {
    for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      const origin = originOf(host);
      if (origin?.startsWith("https://")) origins.add(origin);
    }
  }
  const proxy = oauthProxyOrigin(env);
  if (proxy) origins.add(proxy);
  return [...origins];
}

/**
 * Google sign-in on Vercel previews. Google only redirects to addresses
 * registered on the OAuth client, and every preview has a new one, so with
 * OAUTH_PROXY_URL set, Better Auth's oAuthProxy plugin sends every Google
 * sign-in to that one fixed address. The deployment there exchanges the code
 * with Google, seals the profile with the shared secret and hands it back to
 * the preview the sign-in started on, which creates the session in its own
 * database (running the invite-only hooks there). A sign-in that starts on the
 * fixed address itself is not proxied.
 *
 * OAUTH_PROXY_SECRET, when set, seals the hand-off instead of
 * BETTER_AUTH_SECRET, so the two ends need to share only that. Every
 * deployment taking part needs the same value (or the same
 * BETTER_AUTH_SECRET, when it is unset).
 */
function proxyPlugins(env: Env) {
  const productionURL = oauthProxyOrigin(env);
  if (!productionURL) return [];
  const secret = env.OAUTH_PROXY_SECRET?.trim() || undefined;
  return [oAuthProxy({ productionURL, secret })];
}

function createAuth(db: Db) {
  const google = googleConfig();
  return betterAuth({
    secret: authSecret(),
    baseURL: process.env.BETTER_AUTH_URL?.trim() || undefined,
    trustedOrigins: trustedOrigins(),
    plugins: proxyPlugins(process.env),
    // A sign-in that fails with no error address of its own (the Google
    // button always passes one) comes back to the sign-in page on the address
    // it was on, which explains `?error=` codes, rather than Better Auth's
    // built-in error page.
    onAPIError: { errorURL: "/sign-in" },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    // No passwords: people sign in with Google (and, later, passkeys).
    emailAndPassword: { enabled: false },
    socialProviders: google ? { google } : {},
    user: {
      additionalFields: {
        // Server-only: `input: false` makes every client endpoint refuse a
        // `role` in its body, and keeps it out of what a provider profile can
        // set. Only the before-create hook below decides it.
        //
        // The default is required: Better Auth parses a new OAuth user's
        // fields before any hook runs and refuses a required field with no
        // value (MISSING_FIELD). The hook then replaces it with the real role.
        role: {
          type: [...userRoles],
          required: true,
          input: false,
          defaultValue: "member" satisfies Role,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // The single choke point for invite-only sign-up: every way of
          // creating a user, Google included, goes through here. Throwing
          // stops the insert, so a refused sign-in writes no row. The OAuth
          // callback redirects with the error code (`NOT_INVITED` or
          // `EMAIL_NOT_VERIFIED`) for the sign-in page to explain.
          before: async (user) => {
            if (user.emailVerified !== true) {
              throw new APIError("FORBIDDEN", {
                code: "EMAIL_NOT_VERIFIED",
                message: "This account's email address has not been verified.",
              });
            }
            const role = await signUpRole(user.email, db);
            if (!role) {
              throw new APIError("FORBIDDEN", {
                code: "NOT_INVITED",
                message: "This account hasn't been invited.",
              });
            }
            // Written with the row itself, whatever the caller passed.
            return { data: { role } };
          },
          // Runs once the row exists (for Google, once the account is linked
          // too): the owner gets the family row, a member's invitation is
          // marked accepted. The display name is left as the provider gave
          // it; the invitation's name is only a label.
          //
          // If the invitation was cancelled while this person was signing in,
          // completeSignUp deletes the new user (and their linked account)
          // and the sign-in is refused before any session is created.
          after: async (user) => {
            const kept = await completeSignUp(
              { id: user.id, email: user.email, role: user.role as Role },
              db,
            );
            if (!kept) {
              throw new APIError("FORBIDDEN", {
                code: "NOT_INVITED",
                message: "This account hasn't been invited.",
              });
            }
          },
        },
      },
    },
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      // Every request looks the session up in the database, so removing a
      // member takes effect on their very next request.
      cookieCache: { enabled: false },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * The configured instance, kept at module scope rather than on globalThis so
 * that editing this file in `next dev` rebuilds it on the next request. The
 * database connection underneath is the long-lived part, and getDb() already
 * keeps that on globalThis. Under `next start` this module is evaluated once,
 * so there is one instance per server process. In `next dev`, an edit gives
 * each route that imports this module its own fresh instance, all sharing the
 * one database connection.
 */
let cached: { db: Db; auth: Auth } | undefined;

/** Returns the shared Better Auth instance, creating it on first call. */
export async function getAuth(): Promise<Auth> {
  // Always go through getDb() first: inside Next.js it awaits connection(),
  // which makes every caller request-time, not just the first one.
  const db = await getDb();
  if (cached?.db !== db) {
    // betterAuth() is synchronous, so there is no promise to cache and no
    // window where a half-built instance could be shared. If authSecret()
    // throws, nothing is cached and the next call tries again.
    cached = { db, auth: createAuth(db) };
  }
  return cached.auth;
}
