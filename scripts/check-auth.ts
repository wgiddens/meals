/**
 * Proves the sign-in library fits this app's database layer: build the Better
 * Auth instance on top of getDb(), then create a user and a session, read the
 * session back, and delete the user (which must take the session with it).
 * It also checks the configuration the spec promises: password sign-up is
 * refused, sessions last 90 days and renew on use, the cookie cache is off,
 * and in production a missing BETTER_AUTH_SECRET makes getAuth() fail.
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
import os from "node:os";
import path from "node:path";

/**
 * Set only in the child process that checks the production secret guard. The
 * child is a fresh process so nothing is cached, and runs with
 * NODE_ENV=production and no BETTER_AUTH_SECRET.
 */
const PRODUCTION_CHILD = process.env.CHECK_AUTH_PRODUCTION_CHILD === "1";

const realUrl = process.env.CHECK_AUTH_DATABASE_URL;
if (realUrl) {
  process.env.DATABASE_URL = realUrl;
} else {
  process.env.PGLITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meals-auth-"));
  delete process.env.DATABASE_URL;
}
// The checks must not depend on any sign-in configuration being present.
delete process.env.BETTER_AUTH_SECRET;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

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
  const email = `check-${Date.now()}@example.com`;
  const created = await ctx.internalAdapter.createUser(
    { name: "Check User", email },
    { method: "admin" },
  );
  assert(created.id && created.email === email, "a user row can be created");

  const session = await ctx.internalAdapter.createSession(created.id);
  assert(session.token, "a session row can be created");
  const days = (session.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  assert(
    Math.abs(days - SESSION_MAX_AGE_SECONDS / 86400) < 0.01,
    `the session expires in 90 days (got ${days.toFixed(2)})`,
  );

  const found = await ctx.internalAdapter.findSession(session.token);
  assert(found?.user.email === email, "the session reads back with its user");

  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { makeSignature } = await import("better-auth/crypto");
  const db = await getDb();

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
  const getSession = await auth.handler(
    new Request("http://localhost:3000/api/auth/get-session", {
      headers: { cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}` },
    }),
  );
  const getSessionBody = (await getSession.json().catch(() => null)) as {
    user?: { email?: string };
  } | null;
  assert(
    getSession.status === 200 && getSessionBody?.user?.email === email,
    "get-session accepts the signed session cookie",
  );
  const renewed = await daysLeft();
  assert(Math.abs(renewed - 90) < 0.01, `using the session renews it to 90 days (got ${renewed.toFixed(2)})`);
  const setCookie = getSession.headers.getSetCookie().join("\n");
  assert(
    setCookie.includes(ctx.authCookies.sessionToken.name) &&
      !setCookie.includes(ctx.authCookies.sessionData.name),
    "the renewed cookie is re-issued and no session-data cache cookie is set",
  );

  // Removing the user row must remove their sessions (ON DELETE CASCADE).
  await db.delete(schema.user).where(eq(schema.user.id, created.id));
  assert(
    (await ctx.internalAdapter.findSession(session.token)) === null,
    "deleting the user deletes their session",
  );

  // Production with no secret must fail closed. A fresh child process, so no
  // instance is cached, with its own embedded database when on PGlite (two
  // processes cannot share one PGlite directory).
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    CHECK_AUTH_PRODUCTION_CHILD: "1",
  };
  delete childEnv.BETTER_AUTH_SECRET;
  if (!realUrl) {
    childEnv.PGLITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meals-auth-prod-"));
  }
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

  console.log("\nAuth foundation checks passed.");
  process.exit(0);
}

(PRODUCTION_CHILD ? productionChild() : main()).catch((err) => {
  console.error(err);
  process.exit(1);
});
