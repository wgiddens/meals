/**
 * Proves the sign-in library fits this app's database layer: build the Better
 * Auth instance on top of getDb(), then create a user and a session, read the
 * session back, and delete the user (which must take the session with it).
 * It also checks the configuration the spec promises: password sign-up is
 * refused, sessions last 90 days and renew on use, the cookie cache is off,
 * getAuth() stays request-time (it awaits connection() on every call), and in
 * production a missing BETTER_AUTH_SECRET makes getAuth() fail.
 *
 * And the family rules from src/lib/family.ts as Better Auth enforces them:
 * only OWNER_EMAIL (while there is no owner) or a pending invitation can
 * create a user, only with a verified email; the owner and member roles; the
 * owner-only actions; `role` cannot be set through the client API; and
 * removing a member removes their sessions, accounts and row.
 *
 * And the proxy (src/proxy.ts) as the gate: it looks the session up, so a
 * member gets through while a forged cookie or a removed member's cookie is
 * redirected to sign-in (pages) or gets 401 (API routes).
 *
 * And Google sign-in on Vercel previews (the OAuth proxy in src/lib/auth.ts):
 * the trusted origins stay this project's own, and in a child process with
 * two deployments (a fixed one and a preview, each with its own temporary
 * PGlite) and Google's token endpoint stubbed, a preview sign-in completes
 * through the fixed deployment, while a hand-back forged with the proxy
 * secret is refused by the fixed deployment and by production.
 *
 *   npm run check:auth
 *
 * By default this runs against a throwaway embedded database (PGlite). To run
 * the same checks against a real Postgres server, such as a Neon branch, set
 * CHECK_AUTH_DATABASE_URL; migrations are applied to it first. Never point it
 * at production: it writes and deletes a test user.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * Set only in the child process that checks the production secret guard. The
 * child is a fresh process so nothing is cached, and runs with
 * NODE_ENV=production and no BETTER_AUTH_SECRET.
 */
const PRODUCTION_CHILD = process.env.CHECK_AUTH_PRODUCTION_CHILD === "1";
/** Set only in the child process that checks the OAuth proxy (always PGlite). */
const PROXY_CHILD = process.env.CHECK_AUTH_PROXY_CHILD === "1";

const realUrl = PROXY_CHILD ? undefined : process.env.CHECK_AUTH_DATABASE_URL;
if (realUrl) {
  process.env.DATABASE_URL = realUrl;
} else {
  // Each process (this one and the production child) makes its own directory,
  // since two processes cannot share one PGlite directory, and removes it on
  // the way out however it exits.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meals-auth-"));
  process.env.PGLITE_DATA_DIR = dataDir;
  process.on("exit", () => fs.rmSync(dataDir, { recursive: true, force: true }));
  delete process.env.DATABASE_URL;
}
// The checks must not depend on any sign-in configuration being present.
delete process.env.BETTER_AUTH_SECRET;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.NEXT_RUNTIME;
// Unique per run, so a real Postgres that already holds an owner from an
// earlier run is detected rather than silently reused.
const RUN = Date.now().toString(36);
const OWNER_EMAIL = `owner-${RUN}@example.com`;
process.env.OWNER_EMAIL = OWNER_EMAIL;

/** Child mode: getAuth() must reject, every time, without a secret. */
async function productionChild() {
  if (process.env.NODE_ENV !== "production") throw new Error("child expects NODE_ENV=production");
  const { getAuth } = await import("@/lib/auth");
  for (const attempt of [1, 2]) {
    const outcome = await getAuth().then(
      () => "resolved",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    if (!outcome.includes("BETTER_AUTH_SECRET")) {
      console.error(`attempt ${attempt}: expected a BETTER_AUTH_SECRET error, got: ${outcome}`);
      process.exit(1);
    }
  }
  console.log("getAuth() rejected twice without BETTER_AUTH_SECRET");
  process.exit(0);
}

/**
 * Child mode: the OAuth proxy end to end, through Better Auth's real handler
 * and our own getAuth(). Three deployments, each its own instance and PGlite
 * database: the fixed address previews send Google to, a preview, and
 * production once it is the fixed address. Only Google's token endpoint is
 * stubbed. A forged hand-back is one built with nothing but
 * OAUTH_PROXY_SECRET, the way anyone holding the preview environment could.
 */
async function proxyChild() {
  const { hkdfSync } = await import("node:crypto");
  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
    console.log(`ok - ${msg}`);
  };
  const FIXED = "https://meals-git-epic-accounts-fam.vercel.app";
  const PREVIEW_HOST = "meals-git-feature-fam.vercel.app";
  const PREVIEW = `https://${PREVIEW_HOST}`;
  const PROD = "https://meals.example.com";
  const PROXY_SECRET = "check-auth-proxy-secret-0123456789abcdef";
  const preview = {
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: "check-auth-preview-secret-0123456789ab",
    GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "client-secret",
    OWNER_EMAIL,
    BETTER_AUTH_URL: FIXED,
    OAUTH_PROXY_URL: FIXED,
    OAUTH_PROXY_SECRET: PROXY_SECRET,
    OAUTH_PROXY_PREVIEW_PATTERN: "https://meals-*-fam.vercel.app",
    VERCEL_ENV: "preview",
    VERCEL_URL: "meals-abc123-fam.vercel.app",
    VERCEL_BRANCH_URL: PREVIEW_HOST,
  };
  const deployments = {
    preview,
    fixed: { ...preview, VERCEL_URL: "meals-fix123-fam.vercel.app", VERCEL_BRANCH_URL: new URL(FIXED).host },
    production: {
      ...preview,
      BETTER_AUTH_SECRET: "check-auth-production-secret-0123456789",
      BETTER_AUTH_URL: PROD,
      // Set by mistake: production must ignore every OAUTH_PROXY_* variable.
      OAUTH_PROXY_URL: FIXED,
      VERCEL_ENV: "production",
      VERCEL_URL: "meals-prd123-fam.vercel.app",
      VERCEL_BRANCH_URL: "meals-git-main-fam.vercel.app",
    },
  };
  type Name = keyof typeof deployments;
  const applyEnv = (name: Name) => Object.assign(process.env, deployments[name]);

  const { getAuth, oauthProxyRole } = await import("@/lib/auth");
  const { getDb, schema } = await import("@/db");
  const { symmetricEncrypt, symmetricDecrypt } = await import("better-auth/crypto");

  assert(oauthProxyRole(deployments.fixed) === "fixed", "proxy role: the fixed deployment (VERCEL_BRANCH_URL is the proxy) is fixed");
  assert(oauthProxyRole(deployments.preview) === "receiver", "proxy role: a preview is a receiver");
  assert(
    oauthProxyRole(deployments.production) === "production" &&
      oauthProxyRole({ ...deployments.production, OAUTH_PROXY_URL: PROD, VERCEL_BRANCH_URL: new URL(PROD).host }) === "production" &&
      oauthProxyRole({ VERCEL_ENV: "production" }) === "production",
    "proxy role: production is always production, whatever OAUTH_PROXY_* says",
  );
  assert(
    oauthProxyRole({ ...preview, OAUTH_PROXY_SECRET: undefined }) === "off" &&
      oauthProxyRole({ ...preview, OAUTH_PROXY_SECRET: preview.BETTER_AUTH_SECRET }) === "off" &&
      oauthProxyRole({ ...preview, OAUTH_PROXY_URL: undefined }) === "off",
    "proxy role: off without OAUTH_PROXY_URL, without OAUTH_PROXY_SECRET, or with it equal to BETTER_AUTH_SECRET",
  );

  // Google: the code is base64url JSON {email, nonce}, chosen below.
  const realFetch = globalThis.fetch;
  let tokenExchanges = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://oauth2.googleapis.com/token")) return realFetch(input, init);
    tokenExchanges++;
    const code = new URLSearchParams(String(init?.body)).get("code") ?? "";
    const { email, nonce } = JSON.parse(Buffer.from(code, "base64url").toString());
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: "https://accounts.google.com", aud: preview.GOOGLE_CLIENT_ID, sub: `sub-${email}`, email, email_verified: true, name: "Test", nonce, iat: now, exp: now + 3600 };
    const body = { access_token: "at", id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.sig`, expires_in: 3600, token_type: "Bearer" };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const instances = {} as Record<Name, { auth: Awaited<ReturnType<typeof getAuth>>; db: Awaited<ReturnType<typeof getDb>> }>;
  for (const name of Object.keys(deployments) as Name[]) {
    applyEnv(name);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `meals-auth-proxy-${name}-`));
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
    process.env.PGLITE_DATA_DIR = dir;
    globalThis.__mealsDb = undefined;
    const db = await getDb();
    instances[name] = { auth: await getAuth(), db };
  }

  // One cookie jar per browser and host.
  const jars = new Map<string, Map<string, string>>();
  const call = async (name: Name, url: string, init: RequestInit = {}, browser = "person") => {
    applyEnv(name);
    const host = `${browser}|${new URL(url).host}`;
    const jar = jars.get(host) ?? new Map<string, string>();
    const headers = new Headers(init.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await instances[name].auth.handler(new Request(url, { ...init, headers, redirect: "manual" }));
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (/max-age=0/i.test(c)) jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    jars.set(host, jar);
    return res;
  };
  const startSignIn = async (name: Name, base: string, next = "/", browser = "person") => {
    const res = await call(name, `${base}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ provider: "google", callbackURL: `${base}${next}`, errorCallbackURL: `${base}/sign-in` }),
    }, browser);
    return new URL(((await res.json()) as { url: string }).url);
  };
  const googleReturns = (google: URL, email: string) => {
    const code = Buffer.from(JSON.stringify({ email, nonce: google.searchParams.get("nonce") })).toString("base64url");
    return `${google.searchParams.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(google.searchParams.get("state")!)}`;
  };
  const countRows = async (name: Name) => ({
    users: (await instances[name].db.select().from(schema.user)).length,
    sessions: (await instances[name].db.select().from(schema.session)).length,
  });

  // A normal preview sign-in goes through the fixed deployment and back.
  const google = await startSignIn("preview", PREVIEW, "/plan");
  assert(
    google.searchParams.get("redirect_uri") === `${FIXED}/api/auth/callback/google`,
    "a preview sends Google to the fixed address",
  );
  const handBack = (await call("fixed", googleReturns(google, OWNER_EMAIL))).headers.get("location") ?? "";
  assert(handBack.startsWith(`${PREVIEW}/api/auth/callback/google/oauth-proxy?`), "the fixed deployment hands the sign-in back to the preview");
  // The hand-back is bound to the browser that started sign-in: opened in a
  // browser with no cookies, or in one holding the state cookie of its own
  // sign-in, it is refused and signs no one in.
  const elsewhere = await call("preview", handBack, {}, "other");
  await startSignIn("preview", PREVIEW, "/", "attacker");
  const attacker = await call("preview", handBack, {}, "attacker");
  for (const [label, res] of [["a browser with no cookies", elsewhere], ["a browser with its own sign-in's state cookie", attacker]] as const) {
    assert(
      res.headers.get("location") === "/sign-in?error=state_mismatch" &&
        !res.headers.getSetCookie().some((c) => c.includes("session_token")),
      `the hand-back opened in ${label} is refused (${res.headers.get("location")})`,
    );
  }
  assert((await countRows("preview")).sessions === 0, "and no session was created");
  const done = await call("preview", handBack);
  assert(done.headers.get("location") === `${PREVIEW}/plan`, `the preview completes the sign-in (${done.headers.get("location")})`);
  assert((await countRows("preview")).sessions === 1 && (await countRows("fixed")).users === 0, "the session is on the preview; the fixed deployment created nothing");

  // Forged hand-backs: a Google profile sealed with OAUTH_PROXY_SECRET alone.
  const proxyKey = (purpose: string) =>
    Buffer.from(
      hkdfSync("sha256", PROXY_SECRET, "better-auth:oauth-encryption:v1", `better-auth:${purpose}:v1`, 32),
    ).toString("hex");
  const forge = async (base: string, state: string, apiPath: string, sub = "sub-forged") => {
    const payload = {
      userInfo: { id: sub, email: OWNER_EMAIL, name: "Forged", emailVerified: true },
      account: { providerId: "google", accountId: sub, accessToken: "x" },
      state,
      callbackURL: `${base}/`,
      timestamp: Date.now(),
    };
    const profile = await symmetricEncrypt({ key: proxyKey("oauth-proxy-profile"), data: JSON.stringify(payload) });
    return `${base}/api/auth${apiPath}?callbackURL=${encodeURIComponent(`${base}/`)}&profile=${encodeURIComponent(profile)}`;
  };
  // The state a deployment issued for a sign-in, unsealed from the package.
  const stateOf = async (google: URL) => {
    const sealed = google.searchParams.get("state")!;
    try {
      return JSON.parse(await symmetricDecrypt({ key: proxyKey("oauth-proxy-package"), data: sealed })).state as string;
    } catch {
      return sealed; // not proxied: the raw state
    }
  };

  // The forgery is otherwise valid: a preview accepts it in the browser that
  // started the sign-in, when it names the owner's own Google account. With
  // another Google account for the owner's email it is refused, since
  // implicit linking is off. (Accepted risk: whoever holds the preview
  // environment can sign in to a preview's own database, never production's.)
  const forgedOtherSub = await call("preview", await forge(PREVIEW, await stateOf(await startSignIn("preview", PREVIEW)), "/callback/google/oauth-proxy"));
  assert(
    (forgedOtherSub.headers.get("location") ?? "").includes("error=account_not_linked"),
    `a preview refuses a hand-back for the owner's email from another Google account (${forgedOtherSub.headers.get("location")})`,
  );
  const previewForged = await call(
    "preview",
    await forge(PREVIEW, await stateOf(await startSignIn("preview", PREVIEW)), "/callback/google/oauth-proxy", `sub-${OWNER_EMAIL}`),
  );
  assert(previewForged.headers.get("location") === `${PREVIEW}/`, "a hand-back forged with the proxy secret is otherwise valid (a preview accepts it)");

  for (const [name, base] of [["fixed", FIXED], ["production", PROD]] as [Name, string][]) {
    for (const apiPath of ["/callback/google/oauth-proxy", "/oauth-proxy-callback"]) {
      const state = await stateOf(await startSignIn(name, base));
      const before = await countRows(name);
      const res = await call(name, await forge(base, state, apiPath));
      const after = await countRows(name);
      // The fixed preview refuses it; production has no such route at all.
      const refused =
        name === "production"
          ? res.status === 404 || res.headers.get("location") === "/sign-in?error=proxy_hand_back_refused"
          : res.headers.get("location") === "/sign-in?error=proxy_hand_back_refused";
      assert(
        refused && after.users === before.users && after.sessions === before.sessions &&
          !res.headers.getSetCookie().some((c) => c.includes("session_token")),
        `${name} refuses a forged hand-back on ${apiPath} and signs no one in (${res.status} ${res.headers.get("location")})`,
      );
    }
  }

  // Production never runs the proxy, even with OAUTH_PROXY_* set: the plugin
  // is not loaded, only the hand-back refusal (a second layer) is, and it
  // trusts no proxy origin.
  {
    const prodCtx = await instances.production.auth.$context;
    const ids = (prodCtx.options.plugins ?? []).map((plugin) => plugin.id);
    assert(
      !ids.includes("oauth-proxy") && ids.includes("meals-refuse-oauth-proxy-hand-back") && !ids.includes("meals-guard-oauth-proxy-destinations"),
      `production with OAUTH_PROXY_* set loads no oAuthProxy, only the hand-back refusal (${ids.join(", ")})`,
    );
    assert(!prodCtx.isTrustedOrigin(FIXED), "production does not trust the proxy's address");
    const own = await startSignIn("production", PROD, "/plan");
    assert(
      own.searchParams.get("redirect_uri") === `${PROD}/api/auth/callback/google` && (own.searchParams.get("state") ?? "").length <= 64,
      "production's Google sign-in goes straight back to production, unproxied",
    );
  }

  // A state package sealed with the proxy secret for a foreign destination,
  // with the attacker's own PKCE verifier: the fixed deployment and
  // production refuse it before exchanging the code with Google, so no
  // profile is sealed or sent anywhere. Also for a foreign error address.
  const forgePackage = async (callbackURL: string, errorURL?: string) => {
    const oauthState = `forged-${Math.random().toString(36).slice(2)}`;
    const stateData = { callbackURL, errorURL, codeVerifier: "attacker-chosen-verifier-0123456789abcdef0123", expiresAt: Date.now() + 600_000, oauthState };
    const stateCookie = await symmetricEncrypt({ key: proxyKey("oauth-proxy-state"), data: JSON.stringify(stateData) });
    return symmetricEncrypt({ key: proxyKey("oauth-proxy-package"), data: JSON.stringify({ state: oauthState, stateCookie, isOAuthProxy: true }) });
  };
  const evilHandBack = "https://evil.example/api/auth/callback/google/oauth-proxy?callbackURL=%2F";
  const legitHandBack = `${PREVIEW}/api/auth/callback/google/oauth-proxy?callbackURL=%2F`;
  for (const [name, base] of [["fixed", FIXED], ["production", PROD]] as [Name, string][]) {
    for (const [label, pkg] of [
      ["a foreign destination", await forgePackage(evilHandBack)],
      ["a look-alike destination", await forgePackage("https://meals-x.evil.example-fam.vercel.app/api/auth/callback/google/oauth-proxy")],
      ["a foreign error address", await forgePackage(legitHandBack, "https://evil.example/err")],
    ] as const) {
      const exchangesBefore = tokenExchanges;
      const code = Buffer.from(JSON.stringify({ email: OWNER_EMAIL, nonce: "" })).toString("base64url");
      const res = await call(name, `${base}/api/auth/callback/google?code=${code}&state=${encodeURIComponent(pkg)}`);
      const location = res.headers.get("location") ?? "";
      // The fixed preview refuses the destination; production, with no proxy,
      // sees an unknown state. Either way nothing goes to Google or anywhere else.
      const refused =
        name === "production"
          ? location.startsWith("/sign-in?error=") || location.startsWith(`${PROD}/sign-in?error=`)
          : location === "/sign-in?error=proxy_destination_refused";
      assert(
        refused && !location.includes("evil") && !location.includes("profile=") && tokenExchanges === exchangesBefore,
        `${name} refuses a proxied sign-in for ${label}, before any Google exchange (${res.status} ${location})`,
      );
    }
  }
  // A matching preview destination is still served: the forged package above
  // is refused only for its destination. (The full preview flow, through the
  // real browser state, is checked at the top.)
  {
    const code = Buffer.from(JSON.stringify({ email: OWNER_EMAIL, nonce: "" })).toString("base64url");
    const res = await call("fixed", `${FIXED}/api/auth/callback/google?code=${code}&state=${encodeURIComponent(await forgePackage(legitHandBack))}`);
    assert(
      (res.headers.get("location") ?? "").startsWith(`${PREVIEW}/api/auth/callback/google/oauth-proxy?`),
      "the fixed deployment still hands back to a preview matching OAUTH_PROXY_PREVIEW_PATTERN",
    );
  }
  // With no preview pattern, the fixed deployment hands back nowhere else.
  {
    applyEnv("fixed");
    delete process.env.OAUTH_PROXY_PREVIEW_PATTERN;
    const { proxyDestinationAllowed } = await import("@/lib/auth");
    assert(
      !proxyDestinationAllowed(legitHandBack, process.env) && proxyDestinationAllowed(`${FIXED}/x`, process.env),
      "with OAUTH_PROXY_PREVIEW_PATTERN unset, only the fixed deployment itself is a destination",
    );
    process.env.OAUTH_PROXY_PREVIEW_PATTERN = preview.OAUTH_PROXY_PREVIEW_PATTERN;
  }

  // Google ID-token sign-in is off everywhere.
  for (const [name, base] of [["preview", PREVIEW], ["fixed", FIXED], ["production", PROD]] as [Name, string][]) {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const idToken = `${b64({ alg: "RS256", kid: "k" })}.${b64({ iss: "https://accounts.google.com", aud: preview.GOOGLE_CLIENT_ID, sub: `sub-${OWNER_EMAIL}`, email: OWNER_EMAIL, email_verified: true })}.sig`;
    const res = await call(name, `${base}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ provider: "google", idToken: { token: idToken } }),
    }, "idtoken");
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    assert(
      res.status === 404 && body?.code === "ID_TOKEN_NOT_SUPPORTED" && !res.headers.getSetCookie().some((c) => c.includes("session_token")),
      `${name}: Google ID-token sign-in is refused (${res.status} ${body?.code})`,
    );
  }

  // Each deployment's own sign-in still goes straight through.
  for (const [name, base] of [["fixed", FIXED], ["production", PROD]] as [Name, string][]) {
    const own = await startSignIn(name, base);
    assert(own.searchParams.get("redirect_uri") === `${base}/api/auth/callback/google`, `${name}'s own sign-in is not proxied`);
    const res = await call(name, googleReturns(own, OWNER_EMAIL));
    assert(res.headers.get("location") === `${base}/` && (await countRows(name)).sessions === 1, `${name}'s own sign-in completes there`);
  }

  globalThis.fetch = realFetch;
  console.log("OAuth proxy checks passed");
  process.exit(0);
}

async function main() {
  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
    console.log(`ok - ${msg}`);
  };

  if (realUrl) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(realUrl, { max: 1 });
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    await client.end();
  }
  console.log(`database: ${realUrl ? "Postgres server (postgres-js)" : "embedded PGlite"}`);
  const { getAuth, googleConfig, SESSION_MAX_AGE_SECONDS } = await import("@/lib/auth");
  const family = await import("@/lib/family");
  const { getDb, schema } = await import("@/db");
  const { eq, like, sql } = await import("drizzle-orm");
  const { makeSignature } = await import("better-auth/crypto");
  const db = await getDb();

  if (realUrl) {
    const owners = await db.select().from(schema.user).where(eq(schema.user.role, "owner"));
    assert(
      owners.length === 0,
      "the database has no owner yet (point CHECK_AUTH_DATABASE_URL at an empty database)",
    );
  }

  const auth = await getAuth();
  assert((await getAuth()) === auth, "getAuth() returns the same instance on a second call");
  assert(googleConfig() === null, "Google is off when its client id and secret are unset");

  const ok = await auth.handler(new Request("http://localhost:3000/api/auth/ok"));
  assert(ok.status === 200, "GET /api/auth/ok answers 200 through the handler");

  const signUp = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "X", email: "x@example.com", password: "long-enough-password" }),
    }),
  );
  const signUpBody = (await signUp.json().catch(() => null)) as { code?: string } | null;
  assert(
    signUp.status === 400 && signUpBody?.code === "EMAIL_PASSWORD_SIGN_UP_DISABLED",
    `email-and-password sign-up is refused with EMAIL_PASSWORD_SIGN_UP_DISABLED (got ${signUp.status} ${signUpBody?.code})`,
  );

  const ctx = await auth.$context;
  assert(
    ctx.options.session?.cookieCache?.enabled === false,
    "the session cookie cache is off",
  );
  assert(
    ctx.sessionConfig.expiresIn === 90 * 24 * 60 * 60 &&
      SESSION_MAX_AGE_SECONDS === 90 * 24 * 60 * 60,
    `sessions are configured to last 90 days (expiresIn ${ctx.sessionConfig.expiresIn}s)`,
  );

  // ---- Invite-only sign-up -------------------------------------------------
  // Sign-ups go through handleOAuthUserInfo, the function Better Auth's OAuth
  // callback calls once Google has returned the user's profile: it parses the
  // profile, creates the user (running our database hooks), links the Google
  // account and creates a session. Only the HTTP round trip to Google is
  // skipped. `emailVerified` stands in for Google's email_verified claim;
  // `extra` lands in the provider profile, as unknown claims would.
  const { handleOAuthUserInfo } = await import("better-auth/oauth2");
  const userCount = async (email: string) =>
    (await db.select().from(schema.user).where(eq(schema.user.email, email))).length;
  const errorCode = (err: unknown) =>
    (err as { body?: { code?: string } })?.body?.code ?? (err as { code?: string })?.code ?? String(err);
  const createUser = async (
    name: string,
    email: string,
    emailVerified = true,
    extra: Record<string, unknown> = {},
  ) => {
    const sub = `google-sub-${email.trim().toLowerCase()}`;
    const result = await handleOAuthUserInfo({ context: ctx } as never, {
      userInfo: { id: sub, name, email, emailVerified, ...extra },
      account: { providerId: "google", accountId: sub, accessToken: "access", scope: "openid email profile" },
      callbackURL: "/",
      source: {
        method: "oauth",
        oauth: { providerId: "google", profile: { sub, email, email_verified: emailVerified, name, ...extra } },
      },
    });
    if (result.error || !result.data) throw new Error(`OAuth sign-in failed: ${result.error}`);
    return result.data.user as typeof result.data.user & { role: string };
  };
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => "created",
      (err: unknown) => errorCode(err),
    );

  // With OWNER_EMAIL unset (Will's decision: it closes only the owner route),
  // nobody can sign up before there is an owner, not even the address that
  // will later be the owner.
  delete process.env.OWNER_EMAIL;
  const noOwnerEmailRefusal = await refusal(createUser("Owner", OWNER_EMAIL));
  assert(
    family.ownerEmail() === null &&
      !(await family.canSignUp(OWNER_EMAIL, db)) &&
      noOwnerEmailRefusal === "NOT_INVITED" &&
      (await userCount(OWNER_EMAIL)) === 0,
    `with OWNER_EMAIL unset and no owner, canSignUp is false and Google sign-up is refused with no row (got ${noOwnerEmailRefusal})`,
  );
  process.env.OWNER_EMAIL = OWNER_EMAIL;

  const stranger = `stranger-${RUN}@example.com`;
  assert(!(await family.canSignUp(stranger, db)), "canSignUp is false for an email that is neither owner nor invited");
  const strangerRefusal = await refusal(createUser("Stranger", stranger));
  assert(
    strangerRefusal === "NOT_INVITED" && (await userCount(stranger)) === 0,
    `creating an uninvited user is refused with NOT_INVITED and writes no row (got ${strangerRefusal})`,
  );

  assert(
    await family.canSignUp(`  ${OWNER_EMAIL.toUpperCase()} `, db),
    "canSignUp is true for OWNER_EMAIL while there is no owner, compared case-insensitively",
  );
  const unverifiedRefusal = await refusal(createUser("Owner", OWNER_EMAIL, false));
  assert(
    unverifiedRefusal === "EMAIL_NOT_VERIFIED" && (await userCount(OWNER_EMAIL)) === 0,
    `the owner email is refused when the provider did not verify it, and no row is written (got ${unverifiedRefusal})`,
  );

  // A profile claiming "member" still gets "owner": only the hook decides.
  const owner = await createUser("Will (Google)", OWNER_EMAIL.toUpperCase(), true, { role: "member" });
  assert(
    owner?.role === "owner" && owner.email === OWNER_EMAIL,
    `the owner email becomes the owner through Google sign-up, stored lower-case (got ${owner?.role} ${owner?.email})`,
  );
  let overview = await family.listFamily(db);
  assert(overview.name === "Our family", `creating the owner creates the family "Our family" (got ${overview.name})`);
  const [familyRow] = await db.select().from(schema.family);
  assert(familyRow?.id === 1 && familyRow.name === "Our family", "the family row exists");

  assert(!(await family.canSignUp(OWNER_EMAIL, db)), "once there is an owner, canSignUp(OWNER_EMAIL) is false");
  const ownerAccounts = await db.select().from(schema.account).where(eq(schema.account.userId, owner.id));
  assert(
    ownerAccounts.length === 1 && ownerAccounts[0].providerId === "google",
    "the owner's Google account is linked on sign-up",
  );
  const ownerAgain = await createUser("Will again", OWNER_EMAIL);
  assert(
    ownerAgain.id === owner.id && ownerAgain.role === "owner" && (await userCount(OWNER_EMAIL)) === 1,
    "signing in with Google again reaches the same owner and creates no second account",
  );
  // Implicit account linking is off: the owner's email from a different
  // Google account (another `sub`) is refused, not linked to the owner.
  const otherSub = `google-sub-other-${RUN}`;
  const otherGoogle = await handleOAuthUserInfo({ context: ctx } as never, {
    userInfo: { id: otherSub, name: "Will", email: OWNER_EMAIL, emailVerified: true },
    account: { providerId: "google", accountId: otherSub, accessToken: "access", scope: "openid email profile" },
    callbackURL: "/",
    source: { method: "oauth", oauth: { providerId: "google", profile: { sub: otherSub, email: OWNER_EMAIL, email_verified: true } } },
  }).catch((err: unknown) => ({ error: errorCode(err), data: null }));
  const ownerAccountsAfter = await db.select().from(schema.account).where(eq(schema.account.userId, owner.id));
  assert(
    otherGoogle.error === "account not linked" && !otherGoogle.data && ownerAccountsAfter.length === 1 &&
      ownerAccountsAfter[0].accountId === `google-sub-${OWNER_EMAIL}`,
    `the owner's email from a different Google account (sub) is refused and not linked (got ${otherGoogle.error})`,
  );
  assert(
    (await createUser("Will", OWNER_EMAIL)).id === owner.id,
    "the owner's own Google account (same sub) still signs in",
  );
  const nextOwnerEmail = `next-owner-${RUN}@example.com`;
  process.env.OWNER_EMAIL = nextOwnerEmail;
  const changedOwnerRefusal = await refusal(createUser("Usurper", nextOwnerEmail));
  assert(
    !(await family.canSignUp(nextOwnerEmail, db)) &&
      changedOwnerRefusal === "NOT_INVITED" &&
      (await userCount(nextOwnerEmail)) === 0,
    `changing OWNER_EMAIL after the owner exists grants nothing (got ${changedOwnerRefusal})`,
  );
  process.env.OWNER_EMAIL = OWNER_EMAIL;
  const directSecondOwner = await db
    .insert(schema.user)
    .values({ id: `x-${RUN}`, name: "X", email: `x-${RUN}@example.com`, role: "owner" })
    .then(
      () => "inserted",
      () => "refused",
    );
  assert(directSecondOwner === "refused", "the database itself refuses a second owner row");

  // Once there is an owner, OWNER_EMAIL can be unset and invitations still work.
  delete process.env.OWNER_EMAIL;
  const unsetEmail = `unset-owner-email-${RUN}@example.com`;
  await family.inviteMember(owner, { name: "Unset", email: unsetEmail }, db);
  const unsetMember = await createUser("Unset (Google)", unsetEmail).then(
    (u) => u,
    (err: unknown) => errorCode(err),
  );
  const unsetOutcome = typeof unsetMember === "string" ? unsetMember : unsetMember.role;
  assert(
    unsetOutcome === "member",
    `with OWNER_EMAIL unset after the owner exists, an invitation still lets someone sign up (got ${unsetOutcome})`,
  );
  if (typeof unsetMember !== "string") await family.removeMember(owner, unsetMember.id, db);
  process.env.OWNER_EMAIL = OWNER_EMAIL;

  // ---- Invitations -----------------------------------------------------------
  const memberEmail = `member-${RUN}@example.com`;
  const invitation = await family.inviteMember(
    owner,
    { name: "Shannon", email: `  ${memberEmail.toUpperCase()} ` },
    db,
  );
  assert(invitation.email === memberEmail, "an invitation stores its email lower-case");
  overview = await family.listFamily(db);
  assert(
    overview.invitations.some((i) => i.id === invitation.id && i.name === "Shannon" && i.invitedBy === owner.id),
    "the pending invitation is listed with its name and who invited them",
  );
  const familyError = (promise: Promise<unknown>) =>
    promise.then(
      () => "allowed",
      (err: unknown) => (err instanceof family.FamilyError ? err.code : `unexpected: ${String(err)}`),
    );
  const duplicate = await familyError(family.inviteMember(owner, { name: "Again", email: memberEmail }, db));
  assert(duplicate === "ALREADY_INVITED", `inviting an already-pending email is refused (got ${duplicate})`);
  const existing = await familyError(family.inviteMember(owner, { name: "Me", email: OWNER_EMAIL }, db));
  assert(existing === "ALREADY_MEMBER", `inviting an existing member is refused (got ${existing})`);
  const pendingIndex = await db
    .insert(schema.invitations)
    .values({ name: "Twin", email: memberEmail, invitedBy: owner.id })
    .then(
      () => "inserted",
      () => "refused",
    );
  assert(pendingIndex === "refused", "the database allows at most one pending invitation per email");

  assert(await family.canSignUp(memberEmail.toUpperCase(), db), "canSignUp is true for an invited email");
  const memberUnverified = await refusal(createUser("Shannon", memberEmail, false));
  assert(
    memberUnverified === "EMAIL_NOT_VERIFIED" && (await userCount(memberEmail)) === 0,
    `an invited email is refused when the provider did not verify it (got ${memberUnverified})`,
  );
  const member = await createUser("Shannon G. (Google)", memberEmail, true, { role: "owner" });
  assert(
    member?.role === "member",
    `an invited email becomes a member through Google sign-up, even with a role claim in the profile (got ${member?.role})`,
  );
  assert(
    member.name === "Shannon G. (Google)",
    "the member's display name comes from their profile, not the invitation",
  );
  const [accepted] = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.id, invitation.id));
  assert(accepted?.state === "accepted", `the invitation becomes accepted (got ${accepted?.state})`);
  assert(!(await family.canSignUp(memberEmail, db)), "an accepted invitation does not allow another sign-up");

  // Better Auth's server-side createUser runs the same hook: a role passed by
  // the caller is replaced too.
  const directEmail = `direct-${RUN}@example.com`;
  await family.inviteMember(owner, { name: "Direct", email: directEmail }, db);
  const direct = await ctx.internalAdapter.createUser(
    { name: "Direct", email: directEmail, emailVerified: true, role: "owner" },
    { method: "oauth", oauth: { providerId: "google" } },
  );
  assert(direct?.role === "member", `createUser with role "owner" still makes a member (got ${direct?.role})`);
  await family.removeMember(owner, direct.id, db);

  // An invitation cancelled while its invitee is mid-sign-in: the before-create
  // check has passed, then the owner cancels. Simulated by cancelling while
  // Better Auth links the Google account, which happens between the user
  // insert and the after-create hook.
  const raceEmail = `race-${RUN}@example.com`;
  const raceInvite = await family.inviteMember(owner, { name: "Race", email: raceEmail }, db);
  const realCreateAccount = ctx.internalAdapter.createAccount;
  ctx.internalAdapter.createAccount = async (...args) => {
    await family.cancelInvitation(owner, raceInvite.id, db);
    return realCreateAccount(...args);
  };
  let raceOutcome: string;
  try {
    raceOutcome = await refusal(createUser("Race", raceEmail));
  } finally {
    ctx.internalAdapter.createAccount = realCreateAccount;
  }
  const raceAccounts = await db
    .select()
    .from(schema.account)
    .where(eq(schema.account.accountId, `google-sub-${raceEmail}`));
  assert(
    raceOutcome === "NOT_INVITED" && (await userCount(raceEmail)) === 0 && raceAccounts.length === 0,
    `an invitation cancelled mid-sign-in refuses the sign-in and leaves no user or account (got ${raceOutcome})`,
  );

  // ---- Owner-only actions ----------------------------------------------------
  const laterEmail = `later-${RUN}@example.com`;
  const later = await family.inviteMember(owner, { name: "Later", email: laterEmail }, db);
  for (const [label, attempt] of [
    ["inviteMember", () => family.inviteMember(member, { name: "Friend", email: `friend-${RUN}@example.com` }, db)],
    ["cancelInvitation", () => family.cancelInvitation(member, later.id, db)],
    ["removeMember", () => family.removeMember(member, member.id, db)],
    ["renameFamily", () => family.renameFamily(member, "Mine now", db)],
  ] as const) {
    const outcome = await familyError(attempt());
    assert(outcome === "NOT_OWNER", `${label} refuses a member who is not the owner (got ${outcome})`);
  }
  const ghost = await familyError(family.renameFamily({ id: "no-such-user" }, "Ghost", db));
  assert(ghost === "NOT_OWNER", `an actor who is not in the family is refused (got ${ghost})`);

  await family.cancelInvitation(owner, later.id, db);
  assert(!(await family.canSignUp(laterEmail, db)), "a cancelled invitation no longer allows sign-up");
  const cancelAgain = await familyError(family.cancelInvitation(owner, later.id, db));
  assert(cancelAgain === "INVITATION_NOT_FOUND", `cancelling twice is refused (got ${cancelAgain})`);
  const reinvite = await family.inviteMember(owner, { name: "Later", email: laterEmail }, db);
  assert(reinvite.id !== later.id, "a cancelled email can be invited again");
  await family.cancelInvitation(owner, reinvite.id, db);

  await family.renameFamily(owner, "  The Giddens  ", db);
  overview = await family.listFamily(db);
  assert(overview.name === "The Giddens", "the owner can rename the family");
  assert(
    overview.members[0]?.id === owner.id &&
      overview.members.some((m) => m.id === member.id && m.role === "member" && m.email === memberEmail) &&
      overview.invitations.every((i) => i.email !== memberEmail && i.email !== laterEmail),
    "listFamily shows the owner first, the member, and only pending invitations",
  );
  const removeOwner = await familyError(family.removeMember(owner, owner.id, db));
  assert(removeOwner === "CANNOT_REMOVE_OWNER", `the owner cannot remove themselves (got ${removeOwner})`);

  // ---- Sessions (on the member) ------------------------------------------------
  const email = memberEmail;
  const created = member;
  const session = await ctx.internalAdapter.createSession(created.id);
  assert(session.token, "a session row can be created");
  const days = (session.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  assert(
    Math.abs(days - SESSION_MAX_AGE_SECONDS / 86400) < 0.01,
    `the session expires in 90 days (got ${days.toFixed(2)})`,
  );

  const found = await ctx.internalAdapter.findSession(session.token);
  assert(found?.user.email === email, "the session reads back with its user");

  // Renew on use: pull the session's expiry back to 30 days, then read it
  // through the get-session endpoint with its signed cookie, as a browser
  // would. The row's expiry must move back out to 90 days.
  const DAY_MS = 24 * 60 * 60 * 1000;
  await db
    .update(schema.session)
    .set({ expiresAt: new Date(Date.now() + 30 * DAY_MS) })
    .where(eq(schema.session.token, session.token));
  const daysLeft = async () => {
    const [row] = await db
      .select({ expiresAt: schema.session.expiresAt })
      .from(schema.session)
      .where(eq(schema.session.token, session.token));
    return (row.expiresAt.getTime() - Date.now()) / DAY_MS;
  };
  const backdated = await daysLeft();
  assert(Math.abs(backdated - 30) < 0.01, `the session row is backdated to 30 days (got ${backdated.toFixed(2)})`);
  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  const cookie = `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;
  const getSession = await auth.handler(
    new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie } }),
  );
  const getSessionBody = (await getSession.json().catch(() => null)) as {
    user?: { email?: string; role?: string };
  } | null;
  assert(
    getSession.status === 200 && getSessionBody?.user?.email === email,
    "get-session accepts the signed session cookie",
  );
  assert(getSessionBody?.user?.role === "member", "the session's user carries their role");
  // ---- getAuth() is request-time -----------------------------------------------------
  // Inside Next.js, getDb() awaits connection() so whatever follows is
  // per-request. getAuth() must do that on every call, not only the first
  // (when it builds the instance). Stub connection() before getDb() first
  // imports next/server, and count.
  const nextServer = createRequire(import.meta.url)("next/server") as { connection: () => Promise<void> };
  const realConnection = nextServer.connection;
  let connectionCalls = 0;
  nextServer.connection = async () => {
    connectionCalls += 1;
  };
  process.env.NEXT_RUNTIME = "nodejs";
  try {
    for (let i = 1; i <= 3; i++) {
      assert((await getAuth()) === auth, `getAuth() call ${i} under NEXT_RUNTIME returns the cached instance`);
      assert(connectionCalls === i, `getAuth() call ${i} awaited connection() (calls so far: ${connectionCalls})`);
    }
  } finally {
    delete process.env.NEXT_RUNTIME;
    nextServer.connection = realConnection;
  }

  // ---- The proxy looks the session up ------------------------------------------
  // src/proxy.ts is called directly with a NextRequest, as Next.js calls it.
  // Google is set for these calls only, so the gate is in sign-in mode and not
  // the dev-owner shortcut; the Better Auth instance is already built.
  const { proxy } = await import("@/proxy");
  const { NextRequest } = await import("next/server");
  const { memberForRequest } = await import("@/lib/member");
  const env = process.env as Record<string, string | undefined>;
  /** Runs fn with these environment variables, restoring them afterwards. */
  const withEnv = async <T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]));
    const apply = (values: Record<string, string | undefined>) => {
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
    };
    apply(vars);
    try {
      return await fn();
    } finally {
      apply(saved);
    }
  };
  const google = { GOOGLE_CLIENT_ID: "check-id", GOOGLE_CLIENT_SECRET: "check-secret" };
  const signInMode = <T>(fn: () => Promise<T>) => withEnv(google, fn);
  /** Production with Google but no BETTER_AUTH_SECRET: gateMode is "closed". */
  const closedMode = <T>(fn: () => Promise<T>) =>
    withEnv({ ...google, NODE_ENV: "production", BETTER_AUTH_SECRET: undefined }, fn);
  const callProxy = (pathname: string, cookieHeader?: string) =>
    proxy(
      new NextRequest(`http://localhost:3000${pathname}`, {
        headers: cookieHeader ? { cookie: cookieHeader } : {},
      }),
    );
  const throughProxy = (pathname: string, cookieHeader?: string) =>
    signInMode(() =>
      proxy(
        new NextRequest(`http://localhost:3000${pathname}`, {
          headers: cookieHeader ? { cookie: cookieHeader } : {},
        }),
      ),
    );
  /** "through", "401", or the redirect's path and query. */
  const outcomeOf = (res: Response) => {
    if (res.headers.get("x-middleware-next") === "1") return "through";
    if (res.status === 401) return "401";
    const location = res.headers.get("location");
    return location ? new URL(location).pathname + new URL(location).search : `status ${res.status}`;
  };
  const proxyOutcome = async (pathname: string, cookieHeader?: string) =>
    outcomeOf(await throughProxy(pathname, cookieHeader));
  const forged = `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.forged-signature`)}`;
  const madeUp = `${ctx.authCookies.sessionToken.name}=made-up`;
  assert((await proxyOutcome("/plan", cookie)) === "through", "proxy: a member's session cookie gets to /plan");
  assert((await proxyOutcome("/api/import", cookie)) === "through", "proxy: a member's session cookie gets to /api/import");
  for (const [label, c] of [["no cookie", undefined], ["a forged signature", forged], ["a made-up cookie", madeUp]] as const) {
    const page = await proxyOutcome("/recipes?q=a", c);
    assert(page === "/sign-in?next=%2Frecipes%3Fq%3Da", `proxy: ${label} is redirected to sign-in from a page (got ${page})`);
    const api = await proxyOutcome("/api/plate", c);
    assert(api === "401", `proxy: ${label} gets 401 from /api/* (got ${api})`);
  }
  for (const exempt of ["/sign-in", "/api/auth/get-session", "/api/mcp", "/.well-known/oauth-protected-resource"]) {
    assert((await proxyOutcome(exempt)) === "through", `proxy: ${exempt} is reachable signed out`);
  }
  // Only the exact exempt paths are exempt, not anything that starts the same.
  for (const [lookAlike, expected] of [
    ["/api/auth", "401"],
    ["/api/authx", "401"],
    ["/api/authx/get-session", "401"],
    ["/api/mcpx", "401"],
    ["/sign-inx", "/sign-in?next=%2Fsign-inx"],
    ["/sign-in/x", "/sign-in?next=%2Fsign-in%2Fx"],
    ["/.well-knownx", "/sign-in?next=%2F.well-knownx"],
  ] as const) {
    const got = await proxyOutcome(lookAlike);
    assert(got === expected, `proxy: look-alike path ${lookAlike} is not exempt (got ${got})`);
  }

  // Production with sign-in not configured: a valid cookie gets nowhere.
  const closedPage = outcomeOf(await closedMode(() => callProxy("/plan", cookie)));
  assert(closedPage === "/sign-in?next=%2Fplan", `proxy: closed mode redirects even a valid cookie (got ${closedPage})`);
  const closedApi = outcomeOf(await closedMode(() => callProxy("/api/import", cookie)));
  assert(closedApi === "401", `proxy: closed mode answers 401 to /api/* even with a valid cookie (got ${closedApi})`);
  assert(
    (await closedMode(() => memberForRequest(new Headers({ cookie })))) === null,
    "memberForRequest returns null in closed mode, even for a valid cookie",
  );

  // Renewal reaches the browser: with the session pulled back to 30 days,
  // a request through the proxy renews the row to 90 days and passes the
  // renewed cookie on.
  await db
    .update(schema.session)
    .set({ expiresAt: new Date(Date.now() + 30 * DAY_MS) })
    .where(eq(schema.session.token, session.token));
  const renewedThroughProxy = await throughProxy("/plan", cookie);
  assert(outcomeOf(renewedThroughProxy) === "through", "proxy: the backdated session still gets through");
  const proxyRenewedDays = await daysLeft();
  assert(
    Math.abs(proxyRenewedDays - 90) < 0.01,
    `proxy: the session row is renewed to 90 days (got ${proxyRenewedDays.toFixed(2)})`,
  );
  const renewedCookie = renewedThroughProxy.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${ctx.authCookies.sessionToken.name}=`));
  const maxAge = Number(/max-age=(\d+)/i.exec(renewedCookie ?? "")?.[1]);
  assert(
    renewedCookie?.includes(encodeURIComponent(signed)) && Math.abs(maxAge - SESSION_MAX_AGE_SECONDS) < 5,
    `proxy: the response sets the renewed session cookie for 90 days (got ${renewedCookie ?? "no cookie"})`,
  );
  const notRenewedAgain = await throughProxy("/plan", cookie);
  assert(
    notRenewedAgain.headers.getSetCookie().length === 0,
    "proxy: a session renewed less than a day ago sets no cookie",
  );

  const viaProxy = await signInMode(() => memberForRequest(new Headers({ cookie })));
  assert(
    viaProxy?.id === member.id && viaProxy.role === "member" && viaProxy.email === email,
    "memberForRequest returns the member's id, name, email and role",
  );
  assert(
    (await signInMode(() => memberForRequest(new Headers({ cookie: forged })))) === null,
    "memberForRequest returns null for a forged cookie",
  );

  const renewed = await daysLeft();
  assert(Math.abs(renewed - 90) < 0.01, `using the session renews it to 90 days (got ${renewed.toFixed(2)})`);
  const setCookie = getSession.headers.getSetCookie().join("\n");
  assert(
    setCookie.includes(ctx.authCookies.sessionToken.name) &&
      !setCookie.includes(ctx.authCookies.sessionData.name),
    "the renewed cookie is re-issued and no session-data cache cookie is set",
  );

  // ---- `role` is server-only -----------------------------------------------------
  const updateUser = (body: Record<string, unknown>) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
        body: JSON.stringify(body),
      }),
    );
  const roleOf = async (id: string) =>
    (await db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.id, id)))[0]?.role;
  const promote = await updateUser({ role: "owner" });
  const promoteBody = (await promote.json().catch(() => null)) as { code?: string } | null;
  assert(
    promote.status === 400 && promoteBody?.code === "FIELD_NOT_ALLOWED" && (await roleOf(member.id)) === "member",
    `update-user refuses a role in its body (got ${promote.status} ${promoteBody?.code})`,
  );
  const rename = await updateUser({ name: "Shannon" });
  assert(
    rename.status === 200 && (await roleOf(member.id)) === "member",
    `update-user still works for the name, and leaves the role alone (got ${rename.status})`,
  );
  const userFields = ctx.options.user?.additionalFields?.role;
  assert(userFields?.input === false, "role is declared to Better Auth with input: false");

  // ---- Removing a member -----------------------------------------------------------
  // A stale pending invitation for someone already in the family (left behind
  // if accepting it failed) grants nothing, isn't listed, and is cancelled
  // when they are removed.
  const [stale] = await db
    .insert(schema.invitations)
    .values({ name: "Stale", email: memberEmail, invitedBy: owner.id })
    .returning();
  assert(!(await family.canSignUp(memberEmail, db)), "a pending invitation for an existing member grants nothing");
  assert(
    (await family.listFamily(db)).invitations.every((i) => i.id !== stale.id),
    "listFamily does not show a stale invitation for an existing member",
  );
  const accountsBefore = await db.select().from(schema.account).where(eq(schema.account.userId, member.id));
  assert(accountsBefore.length === 1, "the member has a linked Google account");
  await family.removeMember(owner, member.id, db);
  const accountsAfter = await db.select().from(schema.account).where(eq(schema.account.userId, member.id));
  const sessionsAfter = await db.select().from(schema.session).where(eq(schema.session.userId, member.id));
  assert(
    (await userCount(memberEmail)) === 0 && accountsAfter.length === 0 && sessionsAfter.length === 0,
    "removeMember deletes the member's sessions, linked accounts and user row",
  );
  assert(
    (await ctx.internalAdapter.findSession(session.token)) === null,
    "the removed member's session no longer resolves",
  );
  const [staleAfter] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, stale.id));
  assert(staleAfter?.state === "cancelled", `removeMember cancels the member's pending invitation (got ${staleAfter?.state})`);
  const afterRemoval = await auth.handler(
    new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie } }),
  );
  const afterRemovalBody = await afterRemoval.json().catch(() => "unreadable");
  assert(afterRemovalBody === null, "get-session with the removed member's cookie returns no session");
  const removedPage = await proxyOutcome("/plan", cookie);
  assert(removedPage === "/sign-in?next=%2Fplan", `proxy: the removed member's cookie is redirected to sign-in (got ${removedPage})`);
  const removedApi = await proxyOutcome("/api/import", cookie);
  assert(removedApi === "401", `proxy: the removed member's cookie gets 401 from /api/* (got ${removedApi})`);
  const comeBack = await refusal(createUser("Shannon", memberEmail));
  assert(comeBack === "NOT_INVITED", `a removed member cannot sign up again without a new invitation (got ${comeBack})`);
  const missing = await familyError(family.removeMember(owner, member.id, db));
  assert(missing === "MEMBER_NOT_FOUND", `removing someone not in the family is refused (got ${missing})`);

  // Every table that references the user must cascade, so rows added by later
  // tasks (passkeys) go with the user row.
  const fks = (await db.execute(sql`
    select tc.table_name, rc.delete_rule
    from information_schema.referential_constraints rc
    join information_schema.table_constraints tc
      on tc.constraint_name = rc.constraint_name and tc.constraint_schema = rc.constraint_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = rc.unique_constraint_name and ccu.constraint_schema = rc.unique_constraint_schema
    where ccu.table_name = 'user' and ccu.table_schema = 'public'
  `)) as unknown;
  // postgres-js returns the rows; PGlite returns { rows }.
  type FkRow = { table_name: string; delete_rule: string };
  const fkRows: FkRow[] = Array.isArray(fks) ? fks : ((fks as { rows: FkRow[] }).rows ?? []);
  assert(
    fkRows.length >= 3 && fkRows.every((r) => r.delete_rule === "CASCADE"),
    `every foreign key to "user" is ON DELETE CASCADE (${fkRows.map((r) => `${r.table_name}:${r.delete_rule}`).join(", ")})`,
  );

  // Removing the user row directly also removes their sessions (ON DELETE CASCADE).
  const ownerSession = await ctx.internalAdapter.createSession(owner.id);
  await db.delete(schema.user).where(eq(schema.user.id, owner.id));
  assert(
    (await ctx.internalAdapter.findSession(ownerSession.token)) === null,
    "deleting a user row deletes their session",
  );
  await db.delete(schema.family);
  await db.delete(schema.user).where(like(schema.user.email, `%-${RUN}@example.com`));

  // ---- Trusted origins: this project's own, nothing wider ------------------
  const { trustedOrigins } = await import("@/lib/auth");
  const previewEnv = {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    VERCEL_URL: "meals-abc123-fam.vercel.app",
    VERCEL_BRANCH_URL: "meals-git-feature-fam.vercel.app",
    OAUTH_PROXY_URL: "https://meals-git-epic-accounts-fam.vercel.app/",
  };
  const previewTrusted = trustedOrigins(previewEnv);
  assert(
    JSON.stringify([...previewTrusted].sort()) ===
      JSON.stringify(
        [
          "https://meals-abc123-fam.vercel.app",
          "https://meals-git-feature-fam.vercel.app",
          "https://meals-git-epic-accounts-fam.vercel.app",
        ].sort(),
      ),
    `a preview trusts exactly its own two addresses and the proxy (${previewTrusted.join(", ")})`,
  );
  const trustedCases: [string, Record<string, string | undefined>][] = [
    ["a preview", previewEnv],
    ["production", { NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_URL: "meals-x-fam.vercel.app", VERCEL_BRANCH_URL: "meals-git-main-fam.vercel.app" }],
    ["production with OAUTH_PROXY_URL set by mistake", { NODE_ENV: "production", VERCEL_ENV: "production", OAUTH_PROXY_URL: "https://meals-git-epic-accounts-fam.vercel.app" }],
    ["development", { NODE_ENV: "development" }],
    ["development on a Vercel preview env", { NODE_ENV: "development", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" }],
  ];
  for (const [label, env] of trustedCases) {
    const origins = trustedOrigins(env);
    const production = env.NODE_ENV === "production";
    assert(
      origins.every((o) => !o.includes("*") || (!production && /^http:\/\/(localhost|127\.0\.0\.1):\*$/.test(o))),
      `${label}: no wildcard origin (so nothing like *.vercel.app), except localhost:* outside production (${origins.join(", ") || "none"})`,
    );
    assert(
      origins.some((o) => /localhost|127\.0\.0\.1/.test(o)) === !production,
      `${label}: localhost is trusted ${production ? "not at all" : "(development only)"}`,
    );
  }
  assert(
    trustedOrigins({ NODE_ENV: "production", VERCEL_ENV: "production", OAUTH_PROXY_URL: "https://meals-git-epic-accounts-fam.vercel.app" }).length === 0,
    "production trusts no proxy address, even with OAUTH_PROXY_URL set",
  );
  assert(
    trustedOrigins({ NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_URL: "meals-x-fam.vercel.app" }).length === 0,
    "production trusts nothing beyond BETTER_AUTH_URL when the proxy is off (not even its own per-deployment URL)",
  );
  const trustCtx = await auth.$context;
  assert(
    !trustCtx.isTrustedOrigin("https://evil.vercel.app") && !trustCtx.isTrustedOrigin("https://anything.vercel.app/x"),
    "the running instance does not trust an arbitrary *.vercel.app address",
  );

  // The fixed deployment's allowed hand-back destinations.
  const { previewOriginPattern, proxyDestinationAllowed } = await import("@/lib/auth");
  for (const bad of [
    undefined,
    "",
    "https://*.vercel.app",
    "https://meals-*.vercel.app",
    "https://*-fam.vercel.app",
    "http://meals-*-fam.vercel.app",
    "https://meals-*-fam.vercel.app/",
    "https://meals-*-fam.vercel.app:443",
    "https://meals-*-*-fam.vercel.app",
    "https://meals-fam.vercel.app",
    "https://a.meals-*-fam.vercel.app",
    "https://meals-*-fam",
  ]) {
    assert(previewOriginPattern({ OAUTH_PROXY_PREVIEW_PATTERN: bad }) === null, `preview pattern ${JSON.stringify(bad)} is refused`);
  }
  const patternEnv = {
    BETTER_AUTH_URL: "https://meals-git-epic-accounts-fam.vercel.app",
    OAUTH_PROXY_URL: "https://meals-git-epic-accounts-fam.vercel.app",
    OAUTH_PROXY_PREVIEW_PATTERN: "https://meals-*-fam.vercel.app",
  };
  for (const good of ["https://meals-abc123-fam.vercel.app/api/auth/callback/google/oauth-proxy?x=1", "https://meals-git-feature-fam.vercel.app", "/sign-in", "https://meals-git-epic-accounts-fam.vercel.app/x"]) {
    assert(proxyDestinationAllowed(good, patternEnv), `the fixed deployment may hand back to ${good}`);
  }
  for (const bad of [
    "https://evil.example/x",
    "https://meals-x.evil.example-fam.vercel.app",
    "https://meals-abc-fam.vercel.app.evil.example",
    "http://meals-abc-fam.vercel.app",
    "https://other-abc-fam.vercel.app",
    "https://user@meals-abc-fam.vercel.app",
    "//evil.example",
    "javascript:alert(1)",
    "",
  ]) {
    assert(!proxyDestinationAllowed(bad, patternEnv), `the fixed deployment refuses to hand back to ${JSON.stringify(bad)}`);
  }

  // The OAuth proxy end to end, in its own process (it needs three
  // deployments, each with its own instance and database).
  const proxyEnv: NodeJS.ProcessEnv = { ...process.env, CHECK_AUTH_PROXY_CHILD: "1" };
  delete proxyEnv.PGLITE_DATA_DIR;
  delete proxyEnv.CHECK_AUTH_DATABASE_URL;
  const proxyRun = spawnSync(path.join(process.cwd(), "node_modules", ".bin", "tsx"), ["--tsconfig", "tsconfig.json", process.argv[1]], {
    env: proxyEnv,
    encoding: "utf8",
  });
  for (const line of proxyRun.stdout.split("\n").filter((l) => l.startsWith("ok - "))) console.log(`  (proxy) ${line}`);
  assert(
    proxyRun.status === 0,
    `OAuth proxy: previews sign in through the fixed deployment; forged hand-backs are refused there and in production (child exit ${proxyRun.status}${
      proxyRun.status === 0 ? "" : `: ${(proxyRun.stderr || proxyRun.stdout).trim().slice(-2000)}`
    })`,
  );

  // Production with no secret must fail closed. A fresh child process, so no
  // instance is cached. On PGlite it makes its own temporary database when it
  // loads this script.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    CHECK_AUTH_PRODUCTION_CHILD: "1",
  };
  delete childEnv.BETTER_AUTH_SECRET;
  delete childEnv.PGLITE_DATA_DIR;
  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const child = spawnSync(tsx, ["--tsconfig", "tsconfig.json", process.argv[1]], {
    env: childEnv,
    encoding: "utf8",
  });
  assert(
    child.status === 0,
    `with NODE_ENV=production and no BETTER_AUTH_SECRET, getAuth() rejects (child exit ${child.status}${
      child.status === 0 ? "" : `: ${(child.stderr || child.stdout).trim()}`
    })`,
  );

  console.log("\nAuth foundation and family rule checks passed.");
  process.exit(0);
}

(PRODUCTION_CHILD ? productionChild() : PROXY_CHILD ? proxyChild() : main()).catch((err) => {
  console.error(err);
  process.exit(1);
});
