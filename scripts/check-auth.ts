/**
 * Proves the sign-in library fits this app's database layer: build the Better
 * Auth instance on top of getDb(), then create a user and a session, read the
 * session back, and delete the user (which must take the session with it).
 *
 *   npm run check:auth
 *
 * By default this runs against a throwaway embedded database (PGlite). To run
 * the same checks against a real Postgres server, such as a Neon branch, set
 * CHECK_AUTH_DATABASE_URL; migrations are applied to it first. Never point it
 * at production: it writes and deletes a test user.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  assert(signUp.status >= 400, "email-and-password sign-up is refused");

  const ctx = await auth.$context;
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

  // Removing the user row must remove their sessions (ON DELETE CASCADE).
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  await db.delete(schema.user).where(eq(schema.user.id, created.id));
  assert(
    (await ctx.internalAdapter.findSession(session.token)) === null,
    "deleting the user deletes their session",
  );

  console.log("\nAuth foundation checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
