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

const realUrl = process.env.CHECK_AUTH_DATABASE_URL;
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

  const savedOwnerEmail = process.env.OWNER_EMAIL;
  delete process.env.OWNER_EMAIL;
  assert(family.ownerEmail() === null, "with OWNER_EMAIL unset there is no owner email");
  process.env.OWNER_EMAIL = savedOwnerEmail;

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

(PRODUCTION_CHILD ? productionChild() : main()).catch((err) => {
  console.error(err);
  process.exit(1);
});
