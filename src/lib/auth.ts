import { hkdfSync } from "node:crypto";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { genericOAuth, type GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { ConnectError, connect } from "@vercel/connect/betterauth";
import { and, eq } from "drizzle-orm";
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
 *   - the OAuth proxy's fixed address, which is ours too, except in
 *     production, which has nothing to do with the proxy.
 *
 * This is what keeps the OAuth proxy from being an open redirect. The proxy
 * deployment sends people on to the address sealed in the sign-in's state,
 * and only a deployment holding the shared secret can seal one. That
 * deployment first checks the address against this list, so the return trip
 * can only ever lead back to the deployment where sign-in started.
 * (Whoever holds OAUTH_PROXY_SECRET can seal one too; that is why only
 * previews accept hand-backs at all, see oauthProxyRole().)
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
  if (proxy && env.VERCEL_ENV !== "production") origins.add(proxy);
  return [...origins];
}

/**
 * How this deployment takes part in Google sign-in through the OAuth proxy:
 *
 *   "production" VERCEL_ENV=production. Production and previews are fully
 *                separate (the stakeholder's decision): production signs in
 *                with its own Google client directly, ignores every
 *                OAUTH_PROXY_* variable even if set by mistake, never loads
 *                the oAuthProxy plugin, and still refuses the hand-back paths
 *                as a second layer.
 *   "off"        OAUTH_PROXY_URL is unset (or OAUTH_PROXY_SECRET is missing,
 *                see below): Google redirects straight back here.
 *   "fixed"      the designated preview Google redirects every preview
 *                sign-in to (VERCEL_BRANCH_URL is OAUTH_PROXY_URL): today the
 *                `epic/accounts` branch preview, after the epic merges a
 *                long-lived branch such as `auth-proxy`. It exchanges codes
 *                and hands sign-ins back to previews matching
 *                OAUTH_PROXY_PREVIEW_PATTERN, runs its own sign-ins directly,
 *                and REFUSES every hand-back sent to it.
 *   "receiver"   any other preview (or a local run): its Google sign-ins go
 *                through the fixed preview and come back as a sealed
 *                hand-back, accepted only in the browser that started it.
 *
 * Decided from the environment only, never from the request's host: on
 * Vercel, VERCEL_ENV and VERCEL_BRANCH_URL are set per deployment and a
 * request cannot change them.
 */
export type OAuthProxyRole = "production" | "off" | "fixed" | "receiver";

export function oauthProxyRole(env: Env = process.env): OAuthProxyRole {
  if (env.VERCEL_ENV === "production") return "production";
  const proxy = oauthProxyOrigin(env);
  if (!proxy || !oauthProxySecret(env)) return "off";
  if (originOf(env.VERCEL_BRANCH_URL) === proxy) return "fixed";
  return "receiver";
}

/**
 * The secret that seals the proxy's hand-offs. It must be set, and must not be
 * BETTER_AUTH_SECRET: every preview taking part shares it. Without a usable one the proxy stays off and previews fail closed
 * (Google refuses their unregistered redirect address).
 */
export function oauthProxySecret(env: Env = process.env): string | null {
  const secret = env.OAUTH_PROXY_SECRET?.trim();
  if (!secret || secret === env.BETTER_AUTH_SECRET?.trim()) return null;
  return secret;
}

/**
 * The plugin's hand-back endpoints. A hand-back carries a Google profile
 * sealed with OAUTH_PROXY_SECRET and signs its holder in with no Google step,
 * so only a receiver may accept one.
 */
const HAND_BACK_PATHS = new Set(["/callback/:id/oauth-proxy", "/oauth-proxy-callback"]);
const HAND_BACK_PATH = /^\/callback\/[^/]+\/oauth-proxy\/?$|^\/oauth-proxy-callback\/?$/;

function isHandBackPath(path: string | undefined): boolean {
  return HAND_BACK_PATHS.has(path ?? "") || HAND_BACK_PATH.test(path ?? "");
}

/** Refuses every hand-back before the plugin's endpoint can run. */
function refuseProxyHandBacks(): BetterAuthPlugin {
  return {
    id: "meals-refuse-oauth-proxy-hand-back",
    hooks: {
      before: [
        {
          matcher: (context) => isHandBackPath(context.path),
          handler: createAuthMiddleware(async (ctx) => {
            ctx.context.logger.warn("OAuth proxy hand-back refused on the fixed deployment");
            throw ctx.redirect("/sign-in?error=proxy_hand_back_refused");
          }),
        },
      ],
    },
  };
}

/**
 * A key for one of the plugin's ciphertexts, derived exactly as the installed
 * plugin derives it from a string `secret`: HKDF-SHA256 with Better Auth's
 * OAuth encryption salt and the purpose. If a later Better Auth changes this,
 * unsealing fails and the guards below refuse (fail closed); `npm run
 * check:auth` reports it.
 */
function proxyKey(proxySecret: string, purpose: string): string {
  return Buffer.from(
    hkdfSync("sha256", proxySecret, "better-auth:oauth-encryption:v1", `better-auth:${purpose}:v1`, 32),
  ).toString("hex");
}

/**
 * Where the fixed deployment may hand a sign-in back to, besides itself:
 * OAUTH_PROXY_PREVIEW_PATTERN, one pattern for this project's preview
 * addresses such as `https://meals-*-myteam.vercel.app`. Kept narrow on
 * purpose, and refused (null) otherwise:
 *   - https, a host and nothing else (no port, path, query or user);
 *   - exactly one `*`, inside the first label of the host, with fixed text on
 *     both sides of it in that label (so `https://*.vercel.app` and
 *     `https://meals-*.vercel.app` are refused);
 *   - the `*` matches letters, digits and hyphens only, never a dot.
 * Unset or invalid, the fixed deployment hands back to nowhere but itself, so
 * preview sign-in fails closed.
 */
export function previewOriginPattern(env: Env = process.env): RegExp | null {
  const raw = env.OAUTH_PROXY_PREVIEW_PATTERN?.trim().toLowerCase();
  const match = raw ? /^https:\/\/([a-z0-9-]+)\*([a-z0-9-]+)((?:\.[a-z0-9-]+)+)$/.exec(raw) : null;
  if (!match) return null;
  const [, before, after, rest] = match;
  const escape = (text: string) => text.replace(/[.-]/g, "\\$&");
  return new RegExp(`^https://${escape(before)}[a-z0-9-]+${escape(after)}${escape(rest)}$`);
}

/**
 * Whether the fixed deployment may send a sign-in (or its error) to `url`:
 * a safe path on itself, its own origin (BETTER_AUTH_URL or OAUTH_PROXY_URL),
 * or a preview origin matching OAUTH_PROXY_PREVIEW_PATTERN.
 */
export function proxyDestinationAllowed(url: unknown, env: Env = process.env): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  if (url.startsWith("/")) return !url.startsWith("//") && !url.includes("\\");
  let origin: string;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    origin = parsed.origin;
  } catch {
    return false;
  }
  if (origin === originOf(env.BETTER_AUTH_URL) || origin === oauthProxyOrigin(env)) return true;
  return previewOriginPattern(env)?.test(origin) ?? false;
}

/**
 * On the fixed deployment: before the plugin exchanges a proxied sign-in's
 * code with Google and seals the profile, check where it would send it. The
 * plugin takes the destination from the state package (sealed with
 * OAUTH_PROXY_SECRET) and never checks it, so whoever holds that secret could
 * otherwise have a victim's Google profile, tokens included, delivered to any
 * address. Refused unless the destination (and the error address) pass
 * proxyDestinationAllowed(). Callbacks that are not proxy packages (this
 * deployment's own sign-ins) are left to Better Auth.
 */
function guardProxyDestinations(proxySecret: string, env: Env): BetterAuthPlugin {
  const packageKey = proxyKey(proxySecret, "oauth-proxy-package");
  const stateKey = proxyKey(proxySecret, "oauth-proxy-state");
  const refuse = (ctx: { redirect: (url: string) => unknown; context: { logger: { warn: (m: string) => void } } }) => {
    ctx.context.logger.warn("OAuth proxy refused a sign-in for a destination outside this project");
    return ctx.redirect("/sign-in?error=proxy_destination_refused");
  };
  return {
    id: "meals-guard-oauth-proxy-destinations",
    hooks: {
      before: [
        {
          matcher: (context) => context.path === "/callback/:id" || /^\/callback\/[^/]+\/?$/.test(context.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const fromQuery: unknown = ctx.query?.state;
            const fromBody: unknown = (ctx.body as { state?: unknown } | undefined)?.state;
            const state = typeof fromQuery === "string" ? fromQuery : fromBody;
            if (typeof state !== "string") return;
            let statePackage: { isOAuthProxy?: unknown; stateCookie?: unknown };
            try {
              statePackage = JSON.parse(await symmetricDecrypt({ key: packageKey, data: state }));
            } catch {
              return; // not a proxy package: this deployment's own sign-in
            }
            let destination: unknown;
            let errorURL: unknown;
            try {
              if (typeof statePackage.stateCookie !== "string") throw new Error("no state");
              const stateData = JSON.parse(await symmetricDecrypt({ key: stateKey, data: statePackage.stateCookie })) as {
                callbackURL?: unknown;
                errorURL?: unknown;
              };
              destination = stateData.callbackURL;
              errorURL = stateData.errorURL;
            } catch {
              throw refuse(ctx);
            }
            if (!proxyDestinationAllowed(destination, env) || (errorURL !== undefined && !proxyDestinationAllowed(errorURL, env))) {
              throw refuse(ctx);
            }
          }),
        },
      ],
    },
  };
}

/**
 * Binds a hand-back to the browser that started the sign-in. Starting a
 * Google sign-in stores its OAuth state in the database and sets a signed
 * `state` cookie holding the same value in that browser (Better Auth's
 * database state strategy). The plugin's hand-back step skips the cookie
 * check, so without this a hand-back URL opened in any browser within its 60
 * seconds would sign that browser in. Here the hand-back is unsealed and its
 * state must equal the signed cookie, or it is refused before the plugin runs.
 *
 * The key comes from proxyKey() ("oauth-proxy-profile" purpose).
 */
function bindProxyHandBacksToBrowser(proxySecret: string): BetterAuthPlugin {
  const profileKey = proxyKey(proxySecret, "oauth-proxy-profile");
  return {
    id: "meals-bind-oauth-proxy-hand-back",
    hooks: {
      before: [
        {
          matcher: (context) => isHandBackPath(context.path),
          handler: createAuthMiddleware(async (ctx) => {
            const sealed: unknown = ctx.query?.profile;
            let state: unknown;
            try {
              if (typeof sealed !== "string") throw new Error("no profile");
              state = (JSON.parse(await symmetricDecrypt({ key: profileKey, data: sealed })) as { state?: unknown })
                .state;
            } catch {
              state = undefined;
            }
            const cookie = await ctx.getSignedCookie(
              ctx.context.createAuthCookie("state").name,
              ctx.context.secret,
            );
            if (typeof state !== "string" || !cookie || cookie !== state) {
              ctx.context.logger.warn("OAuth proxy hand-back refused: not from the browser that started sign-in");
              throw ctx.redirect("/sign-in?error=state_mismatch");
            }
          }),
        },
      ],
    },
  };
}

/**
 * Google sign-in on Vercel previews. Google only redirects to addresses
 * registered on the OAuth client, and every preview has a new one, so with
 * OAUTH_PROXY_URL set, Better Auth's oAuthProxy plugin sends every Google
 * sign-in to that one fixed address. The deployment there exchanges the code
 * with Google, seals the profile with OAUTH_PROXY_SECRET and hands it back to
 * the preview the sign-in started on, which creates the session in its own
 * database (running the invite-only hooks there). A sign-in that starts on the
 * fixed address itself is not proxied.
 */
function proxyPlugins(env: Env): BetterAuthPlugin[] {
  const role = oauthProxyRole(env);
  if (role === "production") {
    if (Object.keys(env).some((name) => name.startsWith("OAUTH_PROXY_") && env[name]?.trim())) {
      console.warn("OAUTH_PROXY_* is set in production and ignored: production never runs the OAuth proxy.");
    }
    return [refuseProxyHandBacks()];
  }
  if (role === "off") {
    if (oauthProxyOrigin(env)) {
      console.error(
        "OAUTH_PROXY_URL is set but OAUTH_PROXY_SECRET is missing or equal to BETTER_AUTH_SECRET; " +
          "Google sign-in through the proxy is off.",
      );
    }
    return [];
  }
  const proxy = oAuthProxy({
    productionURL: oauthProxyOrigin(env)!,
    secret: oauthProxySecret(env)!,
  });
  return role === "fixed"
    ? [guardProxyDestinations(oauthProxySecret(env)!, env), refuseProxyHandBacks(), proxy]
    : [bindProxyHandBacksToBrowser(oauthProxySecret(env)!), proxy];
}

/**
 * SPIKE (vercel-connect-auth, branch claude/spike-vercel-connect; never
 * merged): Google sign-in through Vercel Connect's OAuth gateway instead of
 * our own Google client and the OAuth proxy.
 *
 * On only when VERCEL_CONNECT_GOOGLE (the connector's UID or `scl_` key) is
 * set AND this is a Vercel preview or a `vercel env pull`ed local run.
 * Production ignores it whatever is set, so production config is unchanged.
 */
export const CONNECT_GOOGLE_PROVIDER_ID = "google-connect";

export function connectGoogleConnector(env: Env = process.env): string | null {
  if (env.VERCEL_ENV !== "preview" && env.VERCEL_ENV !== "development") return null;
  if (env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview") return null;
  return env.VERCEL_CONNECT_GOOGLE?.trim() || null;
}

/**
 * With Connect, each deployment receives its own callback, so Better Auth's
 * base URL is the address the request came in on, restricted to this
 * deployment's own Vercel addresses (and localhost for a local run). No
 * fixed BETTER_AUTH_URL, no proxy.
 */
function connectBaseURL(env: Env): { allowedHosts: string[] } {
  const hosts = new Set<string>();
  for (const value of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    const origin = originOf(value);
    if (origin?.startsWith("https://")) hosts.add(new URL(origin).host);
  }
  if (env.NODE_ENV !== "production") {
    hosts.add("localhost:*");
    hosts.add("127.0.0.1:*");
  }
  return { allowedHosts: [...hosts] };
}

const CONNECT_USERINFO_URL = "https://connect.vercel.com/oauth/userinfo";

/**
 * The adapter's provider, with getUserInfo re-implemented identically except
 * that it logs what the spike needs to know, without personal data: which
 * claims Connect returns, whether `email_verified` is present and its value,
 * and whether `sub` looks like Google's numeric subject or something
 * Connect-specific.
 */
function connectGoogleProvider(connector: string, db: Db): GenericOAuthConfig {
  const base = connect({ providerId: CONNECT_GOOGLE_PROVIDER_ID, connector });
  return {
    ...base,
    getUserInfo: async (tokens) => {
      if (!tokens.accessToken) {
        throw new ConnectError("Missing access token for Vercel Connect userinfo request", {
          code: "missing_access_token",
        });
      }
      const response = await fetch(CONNECT_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        console.error("[connect-spike] userinfo failed", { status: response.status });
        throw new ConnectError("Failed to fetch Vercel Connect user info", { code: "userinfo_failed" });
      }
      const user = (await response.json()) as Record<string, unknown>;
      const sub = typeof user.sub === "string" ? user.sub : String(user.sub ?? "");
      // Whether this subject is the `sub` an earlier direct Google sign-in
      // stored (provider "google"): if so, existing members can be migrated
      // by renaming their account rows' provider id. A boolean only.
      const [existing] = sub
        ? await db
            .select({ id: schema.account.id })
            .from(schema.account)
            .where(and(eq(schema.account.providerId, "google"), eq(schema.account.accountId, sub)))
            .limit(1)
        : [];
      console.info("[connect-spike] userinfo", {
        subMatchesExistingGoogleAccount: Boolean(existing),
        claimKeys: Object.keys(user).sort(),
        emailVerifiedPresent: "email_verified" in user,
        emailVerifiedValue: user.email_verified,
        subIsGoogleNumeric: /^\d{15,30}$/.test(sub),
        subLength: sub.length,
        subPrefix: sub.replace(/[0-9a-zA-Z]/g, (c) => (/\d/.test(c) ? "9" : "a")).slice(0, 6),
        hdPresent: "hd" in user,
      });
      return {
        id: sub,
        email: user.email as string,
        emailVerified: (user.email_verified as boolean | undefined) ?? false,
        name: user.name as string,
        image: user.picture as string | undefined,
      };
    },
  };
}

function createAuth(db: Db) {
  const google = googleConfig();
  const connector = connectGoogleConnector();
  if (connector) console.info("[connect-spike] Google sign-in through Vercel Connect is on");
  return betterAuth({
    secret: authSecret(),
    baseURL: connector ? connectBaseURL(process.env) : process.env.BETTER_AUTH_URL?.trim() || undefined,
    trustedOrigins: trustedOrigins(),
    plugins: connector
      ? [genericOAuth({ config: [connectGoogleProvider(connector, db)] })]
      : proxyPlugins(process.env),
    // A sign-in that fails with no error address of its own (the Google
    // button always passes one) comes back to the sign-in page on the address
    // it was on, which explains `?error=` codes, rather than Better Auth's
    // built-in error page.
    onAPIError: {
      errorURL: "/sign-in",
      onError(error) {
        if (connector && error instanceof ConnectError) {
          console.error("[connect-spike] Connect error", {
            code: error.code,
            status: error.status,
            statusText: error.statusText,
          });
        }
      },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    // No passwords: people sign in with Google.
    emailAndPassword: { enabled: false },
    account: {
      accountLinking: {
        // A Google sign-in for an existing member's email but a different
        // Google account (`sub`) is refused rather than linked: identity is
        // the Google account the member first signed in with. Someone whose
        // Google account was deleted and re-created is removed and
        // re-invited by the owner (the stakeholder's decision).
        disableImplicitLinking: true,
      },
    },
    // Google sign-in only through the redirect flow. The id_token route
    // (`/sign-in/social` with `idToken`) would accept a Google ID token
    // obtained anywhere, for up to an hour, nonce optional.
    socialProviders: google ? { google: { ...google, disableIdTokenSignIn: true } } : {},
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
