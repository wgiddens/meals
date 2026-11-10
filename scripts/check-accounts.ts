/**
 * Proves the account rules (issue #15) against a throwaway embedded database,
 * one section per acceptance criterion. Every rule is exercised through the
 * code path the app really uses, never re-implemented here:
 *
 *   - sign-up goes through Better Auth's handleOAuthUserInfo, the function its
 *     OAuth callback calls once Google has returned a profile (it runs our
 *     database hooks, links the account and creates a session), and through
 *     its internal createUser, which runs the same hooks;
 *   - owner actions call src/lib/family.ts, as the pages' Server Actions do;
 *   - sessions are looked up with Better Auth's getSession server API and the
 *     member gate's memberForRequest();
 *   - `role` is attacked through Better Auth's update-user endpoint, both as a
 *     server API call and as an HTTP request through its handler;
 *   - the dev-owner shortcut is checked with devOwnerAllowed() from the member
 *     gate, and with lookUpMember() under NODE_ENV=production.
 *
 *   npm run check:accounts      (also run by npm run smoke, and so by CI)
 *
 * It needs no environment variables or secrets: it clears the sign-in ones and
 * sets its own. It stops at the first failed assertion and exits 1.
 *
 * scripts/check-auth.ts covers the sign-in foundation (session lifetime and
 * renewal, the proxy, the production secret guard). Some of its assertions
 * overlap with these; this script is the one that maps to the criteria.
 *
 * To run the same checks against a real Postgres server, set
 * CHECK_ACCOUNTS_DATABASE_URL to an empty, throwaway database; migrations are
 * applied to it first. Never point it at a shared database: it writes and
 * deletes users.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const realUrl = process.env.CHECK_ACCOUNTS_DATABASE_URL;
if (realUrl) {
  process.env.DATABASE_URL = realUrl;
} else {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meals-accounts-"));
  process.env.PGLITE_DATA_DIR = dataDir;
  process.on("exit", () => fs.rmSync(dataDir, { recursive: true, force: true }));
  delete process.env.DATABASE_URL;
}
// Nothing from the caller's environment may decide the outcome.
for (const name of ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NEXT_RUNTIME"]) {
  delete process.env[name];
}
const env = process.env as Record<string, string | undefined>;
if (env.NODE_ENV === "production") delete env.NODE_ENV;
const RUN = Date.now().toString(36);
const OWNER_EMAIL = `owner-${RUN}@example.com`;
process.env.OWNER_EMAIL = OWNER_EMAIL;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}

function section(title: string) {
  console.log(`\n# ${title}`);
}

/** Runs fn with these environment variables, restoring them afterwards. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
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
}

async function main() {
  section("[1] the script is wired into smoke, check:accounts and CI");
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert(
    pkg.scripts["check:accounts"]?.includes("scripts/check-accounts.ts"),
    "1.1 package.json has check:accounts running scripts/check-accounts.ts",
  );
  assert(
    /(^|&&)\s*npm run check:accounts\s*(&&|$)/.test(pkg.scripts.smoke ?? ""),
    "1.2 npm run smoke runs npm run check:accounts",
  );
  const ci = fs.readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
  assert(/^\s*run: npm run smoke\s*$/m.test(ci), "1.3 CI runs npm run smoke");
  assert(!/\$\{\{[^}]*\bsecrets\./.test(ci), "1.4 the CI workflow reads no secrets");

  if (realUrl) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(realUrl, { max: 1 });
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    await client.end();
  }
  console.log(`\ndatabase: ${realUrl ? "Postgres server (postgres-js)" : "embedded PGlite"}`);

  const { getAuth } = await import("@/lib/auth");
  const family = await import("@/lib/family");
  const member = await import("@/lib/member");
  const { getDb, schema } = await import("@/db");
  const { eq, sql } = await import("drizzle-orm");
  const { makeSignature } = await import("better-auth/crypto");
  const { handleOAuthUserInfo } = await import("better-auth/oauth2");
  const db = await getDb();

  const users = await db.select({ id: schema.user.id }).from(schema.user);
  assert(users.length === 0, "the database starts with no users (use an empty, throwaway database)");

  // Records every insert into "user", so a check can tell a refused sign-up
  // that never wrote a row from one whose row was written and then deleted
  // again (the after-create hook's fallback). Test instrumentation only, in
  // the throwaway database; dropped at the end.
  await db.execute(sql`create table check_accounts_user_inserts (email text not null)`);
  await db.execute(sql`
    create function check_accounts_record_user_insert() returns trigger language plpgsql as $$
    begin insert into check_accounts_user_inserts (email) values (new.email); return new; end $$`);
  await db.execute(sql`
    create trigger check_accounts_user_insert after insert on "user"
    for each row execute function check_accounts_record_user_insert()`);
  const insertsFor = async (email: string) => {
    const result = (await db.execute(
      sql`select count(*)::int as n from check_accounts_user_inserts where email = ${email}`,
    )) as unknown;
    // postgres-js returns the rows; PGlite returns { rows }.
    const rows = (Array.isArray(result) ? result : (result as { rows: { n: number }[] }).rows) as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  };

  const auth = await getAuth();
  const ctx = await auth.$context;

  // ---- Helpers over the real code paths --------------------------------------
  type CreatedUser = { id: string; email: string; role: string; name: string };
  const errorCode = (err: unknown) =>
    (err as { body?: { code?: string } })?.body?.code ?? (err as { code?: string })?.code ?? String(err);

  /**
   * Signs someone in with Google as Better Auth's OAuth callback does, minus
   * the HTTP round trip to Google: it creates the user (running our hooks),
   * links the account and creates a session. Returns the user and a signed
   * session cookie, as the browser would hold it.
   */
  const googleSignIn = async (name: string, email: string, extraClaims: Record<string, unknown> = {}) => {
    const sub = `google-sub-${email.trim().toLowerCase()}`;
    const result = await handleOAuthUserInfo({ context: ctx } as never, {
      userInfo: { id: sub, name, email, emailVerified: true, ...extraClaims },
      account: { providerId: "google", accountId: sub, accessToken: "access", scope: "openid email profile" },
      callbackURL: "/",
      source: {
        method: "oauth",
        oauth: { providerId: "google", profile: { sub, email, email_verified: true, name, ...extraClaims } },
      },
    });
    if (result.error || !result.data) throw new Error(`OAuth sign-in failed: ${result.error}`);
    const token = result.data.session.token;
    const signed = `${token}.${await makeSignature(token, ctx.secret)}`;
    return {
      user: result.data.user as unknown as CreatedUser,
      token,
      cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`,
    };
  };
  /** googleSignIn() that must succeed; a refusal fails the named assertion. */
  const expectSignIn = async (label: string, name: string, email: string, extraClaims: Record<string, unknown> = {}) => {
    try {
      return await googleSignIn(name, email, extraClaims);
    } catch (err) {
      assert(false, `${label}: sign-in for ${email} was refused (${errorCode(err)})`);
    }
  };
  /** Better Auth's server-side createUser, which runs the same hooks. */
  const adapterCreateUser = (name: string, email: string, role?: string) =>
    ctx.internalAdapter.createUser(
      { name, email, emailVerified: true, ...(role ? { role } : {}) },
      { method: "oauth", oauth: { providerId: "google" } },
    ) as Promise<CreatedUser>;
  /** "created", or the refusal's error code. */
  const outcome = (promise: Promise<unknown>) =>
    promise.then(
      () => "created",
      (err: unknown) => errorCode(err),
    );
  const familyOutcome = (promise: Promise<unknown>) =>
    promise.then(
      () => "allowed",
      (err: unknown) => (err instanceof family.FamilyError ? err.code : `unexpected: ${String(err)}`),
    );
  const usersWithEmail = async (email: string) =>
    db.select().from(schema.user).where(eq(schema.user.email, email.trim().toLowerCase()));
  const owners = async () => db.select().from(schema.user).where(eq(schema.user.role, "owner"));
  const roleOf = async (id: string) =>
    (await db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.id, id)))[0]?.role;
  const sessionFor = (cookie: string) => auth.api.getSession({ headers: new Headers({ cookie }) });
  const google = { GOOGLE_CLIENT_ID: "check-id", GOOGLE_CLIENT_SECRET: "check-secret" };

  // ---- [2] Neither owner nor invited ------------------------------------------
  section("[2] an email that is neither the owner nor invited cannot create a user");
  const stranger = `stranger-${RUN}@example.com`;
  const strangerBeforeOwner = await outcome(googleSignIn("Stranger", stranger));
  assert(
    strangerBeforeOwner === "NOT_INVITED" && (await usersWithEmail(stranger)).length === 0,
    `2.1 before there is an owner, Google sign-up for a stranger is refused with NOT_INVITED and writes no row (got ${strangerBeforeOwner})`,
  );
  const strangerDirect = await outcome(adapterCreateUser("Stranger", stranger, "member"));
  assert(
    strangerDirect === "NOT_INVITED" && (await usersWithEmail(stranger)).length === 0,
    `2.2 Better Auth's createUser for a stranger is refused too, even asking for role member (got ${strangerDirect})`,
  );
  const strangerAccounts = await db
    .select()
    .from(schema.account)
    .where(eq(schema.account.accountId, `google-sub-${stranger}`));
  assert(strangerAccounts.length === 0, "2.3 a refused sign-up links no Google account");
  assert(
    (await insertsFor(stranger)) === 0,
    "2.5 the stranger's user row was never written, not even briefly: the before-create hook refused it",
  );

  // ---- [3] The owner -----------------------------------------------------------
  section("[3] the owner email creates the family row and gets role owner");
  assert((await db.select().from(schema.family)).length === 0, "3.1 there is no family row before the owner signs up");
  // Mixed case, and a profile claim asking for "member": only the hook decides.
  const ownerSignIn = await expectSignIn("3.2", "Will", OWNER_EMAIL.toUpperCase(), { role: "member" });
  const owner = ownerSignIn.user;
  assert(
    owner.role === "owner" && owner.email === OWNER_EMAIL,
    `3.2 OWNER_EMAIL (signed in upper-case) becomes a user with role owner (got ${owner.role} ${owner.email})`,
  );
  assert((await roleOf(owner.id)) === "owner", "3.3 the stored row has role owner");
  const familyRows = await db.select().from(schema.family);
  assert(
    familyRows.length === 1 && familyRows[0].id === 1 && familyRows[0].name === family.DEFAULT_FAMILY_NAME,
    `3.4 the owner's sign-up creates the one family row, named "${family.DEFAULT_FAMILY_NAME}"`,
  );

  const strangerAfterOwner = await outcome(googleSignIn("Stranger", stranger));
  assert(
    strangerAfterOwner === "NOT_INVITED" && (await usersWithEmail(stranger)).length === 0,
    `2.4 once there is an owner, a stranger is still refused (got ${strangerAfterOwner})`,
  );
  assert((await insertsFor(stranger)) === 0, "2.6 and again no user row was ever written for them");

  // ---- [4] Invited members -----------------------------------------------------
  section("[4] an invited email becomes a member, its invitation becomes accepted; case is ignored");
  // Invited in one casing, signs in with another.
  const shannonEmail = `shannon-${RUN}@example.com`;
  const shannonInvite = await family.inviteMember(
    owner,
    { name: "Shannon", email: `  Shannon-${RUN}@Example.COM ` },
    db,
  );
  assert(shannonInvite.email === shannonEmail, "4.1 the invitation is stored under the lower-case email");
  assert(
    await family.canSignUp(shannonEmail.toUpperCase(), db),
    "4.2 the sign-up rule matches the invitation whatever the case of the email",
  );
  const shannonSignIn = await expectSignIn("4.3", "Shannon G.", shannonEmail.toUpperCase(), { role: "owner" });
  const shannon = shannonSignIn.user;
  assert(
    shannon.role === "member" && shannon.email === shannonEmail,
    `4.3 the invited email, signing in upper-case, becomes a member, even with a role claim of owner (got ${shannon.role} ${shannon.email})`,
  );
  const invitationState = async (id: string) =>
    (await db.select().from(schema.invitations).where(eq(schema.invitations.id, id)))[0]?.state;
  assert(
    (await invitationState(shannonInvite.id)) === "accepted",
    `4.4 the invitation becomes accepted (got ${await invitationState(shannonInvite.id)})`,
  );
  assert(
    (await owners()).length === 1 && (await roleOf(owner.id)) === "owner",
    "4.5 a member signing up leaves exactly one owner",
  );
  // The server-side createUser path, with the caller asking for "owner".
  const directEmail = `direct-${RUN}@example.com`;
  const directInvite = await family.inviteMember(owner, { name: "Direct", email: directEmail.toUpperCase() }, db);
  const direct = await adapterCreateUser("Direct", directEmail, "owner");
  assert(
    direct.role === "member" && (await invitationState(directInvite.id)) === "accepted",
    `4.6 Better Auth's createUser for an invited email asking for role owner makes a member and accepts the invitation (got ${direct.role})`,
  );

  // ---- [5] Owner-only actions ----------------------------------------------------
  section("[5] inviteMember, cancelInvitation, removeMember and renameFamily refuse a non-owner");
  const pendingEmail = `pending-${RUN}@example.com`;
  const pending = await family.inviteMember(owner, { name: "Pending", email: pendingEmail }, db);
  const friendEmail = `friend-${RUN}@example.com`;
  const invitationsFor = async (email: string) =>
    db.select().from(schema.invitations).where(eq(schema.invitations.email, email));
  const attempts = [
    ["inviteMember", () => family.inviteMember(shannon, { name: "Friend", email: friendEmail }, db)],
    ["cancelInvitation", () => family.cancelInvitation(shannon, pending.id, db)],
    ["removeMember", () => family.removeMember(shannon, direct.id, db)],
    ["renameFamily", () => family.renameFamily(shannon, "Shannon's family", db)],
  ] as const;
  for (const [i, [label, attempt]] of attempts.entries()) {
    const got = await familyOutcome(attempt());
    assert(got === "NOT_OWNER", `5.${i + 1} ${label} refuses a member with NOT_OWNER (got ${got})`);
  }
  const overview = await family.listFamily(db);
  assert(
    (await invitationsFor(friendEmail)).length === 0 &&
      (await invitationState(pending.id)) === "pending" &&
      (await usersWithEmail(directEmail)).length === 1 &&
      overview.name === family.DEFAULT_FAMILY_NAME,
    "5.5 none of the refused actions changed anything",
  );
  const ghost = await familyOutcome(family.renameFamily({ id: `no-such-user-${RUN}` }, "Ghost", db));
  assert(ghost === "NOT_OWNER", `5.6 an actor who is not in the family is refused too (got ${ghost})`);

  // ---- [6] Duplicate invitations ------------------------------------------------
  section("[6] inviting an existing member or an already pending email is refused");
  const asMember = await familyOutcome(
    family.inviteMember(owner, { name: "Shannon", email: shannonEmail.toUpperCase() }, db),
  );
  assert(asMember === "ALREADY_MEMBER", `6.1 inviting an existing member (in another case) is refused (got ${asMember})`);
  const asOwner = await familyOutcome(family.inviteMember(owner, { name: "Will", email: OWNER_EMAIL }, db));
  assert(asOwner === "ALREADY_MEMBER", `6.2 inviting the owner's own email is refused (got ${asOwner})`);
  const twice = await familyOutcome(
    family.inviteMember(owner, { name: "Pending again", email: ` ${pendingEmail.toUpperCase()}` }, db),
  );
  assert(twice === "ALREADY_INVITED", `6.3 inviting an already pending email (in another case) is refused (got ${twice})`);
  assert(
    (await invitationsFor(shannonEmail)).filter((i) => i.state === "pending").length === 0 &&
      (await invitationsFor(pendingEmail)).length === 1,
    "6.4 the refused invitations wrote no rows",
  );

  // ---- [9] role is server-only ----------------------------------------------------
  section("[9] role cannot be changed through Better Auth's update-user API");
  // Better Auth's types already leave `role` out of the body; the cast sends it
  // anyway, as a hand-made request would.
  const updateUser = (cookie: string, body: Record<string, unknown>) =>
    auth.api.updateUser({ body: body as never, headers: new Headers({ cookie }) });
  for (const [label, body] of [
    ["role alone", { role: "owner" }],
    ["role with a name", { name: "Shannon the owner", role: "owner" }],
  ] as const) {
    const got = await outcome(updateUser(shannonSignIn.cookie, body));
    assert(
      got === "FIELD_NOT_ALLOWED" && (await roleOf(shannon.id)) === "member",
      `9.1 server API updateUser with ${label} is refused with FIELD_NOT_ALLOWED; the role stays member (got ${got})`,
    );
  }
  assert(
    (await usersWithEmail(shannonEmail))[0]?.name === "Shannon G.",
    "9.2 the refused update changed nothing, not even the name sent with it",
  );
  const httpUpdate = await auth.handler(
    new Request("http://localhost:3000/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: shannonSignIn.cookie },
      body: JSON.stringify({ role: "owner" }),
    }),
  );
  const httpBody = (await httpUpdate.json().catch(() => null)) as { code?: string } | null;
  assert(
    httpUpdate.status === 400 && httpBody?.code === "FIELD_NOT_ALLOWED" && (await roleOf(shannon.id)) === "member",
    `9.3 POST /api/auth/update-user with a role is refused (got ${httpUpdate.status} ${httpBody?.code})`,
  );
  const demote = await outcome(
    updateUser(ownerSignIn.cookie, { role: "member" }),
  );
  assert(
    demote === "FIELD_NOT_ALLOWED" && (await roleOf(owner.id)) === "owner",
    `9.4 the owner cannot change their own role either (got ${demote})`,
  );
  const rename = await outcome(updateUser(shannonSignIn.cookie, { name: "Shannon" }));
  assert(
    rename === "created" && (await usersWithEmail(shannonEmail))[0]?.name === "Shannon",
    `9.5 update-user still works for the name, so the refusals above are about role (got ${rename})`,
  );

  // ---- [8] Only one owner -------------------------------------------------------------
  section("[8] once an owner exists, the OWNER_EMAIL address cannot create a second owner");
  // OWNER_EMAIL now names an address with no account, as after changing it.
  const nextOwnerEmail = `next-owner-${RUN}@example.com`;
  await withEnv({ OWNER_EMAIL: nextOwnerEmail }, async () => {
    const viaGoogle = await outcome(googleSignIn("Usurper", nextOwnerEmail));
    assert(
      viaGoogle === "NOT_INVITED" && (await usersWithEmail(nextOwnerEmail)).length === 0,
      `8.1 Google sign-up with OWNER_EMAIL is refused once an owner exists (got ${viaGoogle})`,
    );
    const viaAdapter = await outcome(adapterCreateUser("Usurper", nextOwnerEmail, "owner"));
    assert(
      viaAdapter === "NOT_INVITED" && (await usersWithEmail(nextOwnerEmail)).length === 0,
      `8.2 Better Auth's createUser with OWNER_EMAIL and role owner is refused too (got ${viaAdapter})`,
    );
    assert((await insertsFor(nextOwnerEmail)) === 0, "8.3 no user row was ever written for OWNER_EMAIL");
    // Invited as well: the invitation makes them a member, never an owner.
    await family.inviteMember(owner, { name: "Invited owner email", email: nextOwnerEmail }, db);
    const invited = await expectSignIn("8.4", "Invited owner email", nextOwnerEmail);
    assert(
      invited.user.role === "member",
      `8.4 an invited OWNER_EMAIL becomes a member, not a second owner (got ${invited.user.role})`,
    );
    await family.removeMember(owner, invited.user.id, db);
  });
  const again = await expectSignIn("8.5", "Will again", OWNER_EMAIL);
  assert(
    again.user.id === owner.id && (await usersWithEmail(OWNER_EMAIL)).length === 1,
    "8.5 the owner signing in again reaches the same account",
  );
  const ownerRows = await owners();
  assert(ownerRows.length === 1 && ownerRows[0].id === owner.id, `8.6 there is still exactly one owner (found ${ownerRows.length})`);

  // ---- [7] Removing a member --------------------------------------------------------
  section("[7] removing a member deletes their sessions, and a lookup then fails; the owner cannot be removed");
  // A second session, as from a second phone.
  const secondSession = await ctx.internalAdapter.createSession(shannon.id);
  const shannonSessions = async () =>
    db.select().from(schema.session).where(eq(schema.session.userId, shannon.id));
  assert((await shannonSessions()).length === 2, "7.1 the member has two sessions before removal");
  // Everything the member's browser would hold: the session cookie, plus any
  // cookie Better Auth sets when the session is read (such as a session-data
  // cache, which would let a removed member through).
  const read = await auth.handler(
    new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie: shannonSignIn.cookie } }),
  );
  const jar = new Map([[ctx.authCookies.sessionToken.name, shannonSignIn.cookie.split("=").slice(1).join("=")]]);
  for (const c of read.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const browserCookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  assert(
    (await sessionFor(browserCookie))?.user.id === shannon.id,
    "7.2 before removal, getSession resolves the member's cookies",
  );
  assert(
    (await withEnv(google, () => member.memberForRequest(new Headers({ cookie: browserCookie }))))?.id ===
      shannon.id,
    "7.3 before removal, the member gate resolves the member's cookie",
  );
  await family.removeMember(owner, shannon.id, db);
  assert((await shannonSessions()).length === 0, "7.4 removeMember deletes every session of the member");
  assert(
    (await ctx.internalAdapter.findSession(shannonSignIn.token)) === null &&
      (await ctx.internalAdapter.findSession(secondSession.token)) === null,
    "7.5 Better Auth no longer finds either session",
  );
  assert((await sessionFor(browserCookie)) === null, "7.6 getSession with the removed member's cookies returns null");
  assert(
    (await withEnv(google, () => member.memberForRequest(new Headers({ cookie: browserCookie })))) === null,
    "7.7 the member gate returns no member for the removed member's cookies",
  );
  const removeOwner = await familyOutcome(family.removeMember(owner, owner.id, db));
  assert(removeOwner === "CANNOT_REMOVE_OWNER", `7.8 removing the owner is refused (got ${removeOwner})`);
  assert(
    (await roleOf(owner.id)) === "owner" && (await sessionFor(ownerSignIn.cookie))?.user.id === owner.id,
    "7.9 the owner and their session are still there",
  );

  // ---- [10] No dev owner in production -------------------------------------------------
  section("[10] the dev-owner shortcut is refused when NODE_ENV is production");
  const toggles = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "BETTER_AUTH_SECRET"] as const;
  const values = [undefined, "", " ", "set"];
  let combos = 0;
  for (let mask = 0; mask < values.length ** toggles.length; mask++) {
    const productionEnv: Record<string, string | undefined> = { NODE_ENV: "production" };
    toggles.forEach((name, i) => {
      productionEnv[name] = values[Math.floor(mask / values.length ** i) % values.length];
    });
    if (member.devOwnerAllowed(productionEnv)) {
      assert(false, `10.1 devOwnerAllowed is false in production (true for ${JSON.stringify(productionEnv)})`);
    }
    combos++;
  }
  assert(combos === 64, `10.1 devOwnerAllowed is false for all ${combos} production configurations of Google and the secret`);
  assert(
    member.devOwnerAllowed({ NODE_ENV: "development" }) && member.devOwnerAllowed({}),
    "10.2 outside production with no Google client the shortcut is allowed, so 10.1 is not vacuous",
  );
  // The gate itself: with no sign-in configuration, production lets nobody in
  // and makes no dev owner.
  const devOwnerRows = async () => db.select().from(schema.user).where(eq(schema.user.id, member.DEV_OWNER.id));
  const productionLookup = await withEnv({ NODE_ENV: "production" }, () =>
    member.lookUpMember(new Headers({ cookie: ownerSignIn.cookie })),
  );
  assert(
    productionLookup.member === null && (await devOwnerRows()).length === 0,
    "10.3 in production with no Google client, lookUpMember returns nobody and creates no dev owner",
  );

  // ---- [8] continued: a dev owner exists, then OWNER_EMAIL is configured -------------------
  section("[8] continued: the OWNER_EMAIL address cannot take over from a dev owner");
  // A fresh family whose owner is the local dev owner, as on a laptop that
  // later configures Google and OWNER_EMAIL.
  await db.delete(schema.user);
  await db.delete(schema.invitations);
  await db.delete(schema.family);
  const devOwner = await member.ensureDevOwner(db);
  assert(devOwner.id === member.DEV_OWNER.id && devOwner.role === "owner", "8.7 the dev owner is the family's owner");
  const takeover = await outcome(googleSignIn("Will", OWNER_EMAIL));
  assert(
    takeover === "NOT_INVITED" && (await usersWithEmail(OWNER_EMAIL)).length === 0 && (await insertsFor(OWNER_EMAIL)) === 1,
    `8.8 OWNER_EMAIL cannot sign up as a second owner beside the dev owner, and no new row is written (got ${takeover})`,
  );
  const devOwners = await owners();
  assert(devOwners.length === 1 && devOwners[0].id === member.DEV_OWNER.id, "8.9 the dev owner is still the only owner");

  // Leave nothing behind on a real server.
  await db.delete(schema.user).where(eq(schema.user.id, member.DEV_OWNER.id));
  await db.delete(schema.family);
  await db.execute(sql`drop trigger check_accounts_user_insert on "user"`);
  await db.execute(sql`drop function check_accounts_record_user_insert()`);
  await db.execute(sql`drop table check_accounts_user_inserts`);

  console.log("\nAccount rule checks passed.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
