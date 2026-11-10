import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb, schema, type Db } from "@/db";
import type { Role } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { completeSignUp, FamilyError } from "@/lib/family";
import { gateMode } from "@/lib/gate";

export { devOwnerAllowed, gateMode, safeReturnPath, type GateMode } from "@/lib/gate";

/**
 * Who is signed in. src/proxy.ts calls memberForRequest() on every gated
 * request, so pages are protected by the proxy. Server Actions and API routes
 * still call requireMember() or requireOwner() themselves, as a second check
 * that does not depend on the proxy's matcher.
 *
 * They read the request (headers and the database), so a page that calls
 * them renders them inside <Suspense>. Never call them inside a
 * `'use cache: private'` scope: getAuth() awaits connection(), which that
 * scope refuses. Read the member outside it and pass the values in.
 */

/** The signed-in member, as later features need them. */
export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

/** Thrown by requireMember() when nobody is signed in. */
export class NotSignedInError extends Error {
  constructor() {
    super("Sign in first.");
    this.name = "NotSignedInError";
  }
}

/** The built-in owner for local development (see devOwnerAllowed()). */
export const DEV_OWNER = {
  id: "dev-owner",
  name: "Dev owner",
  email: "dev-owner@localhost",
} as const;

const memberColumns = {
  id: schema.user.id,
  name: schema.user.name,
  email: schema.user.email,
  role: schema.user.role,
};

async function findOwner(db: Db): Promise<Member | null> {
  const [owner] = await db
    .select(memberColumns)
    .from(schema.user)
    .where(eq(schema.user.role, "owner"))
    .limit(1);
  return owner ?? null;
}

/**
 * The family's owner for local development, created on first use. Only for
 * when devOwnerAllowed() is true; currentMember() checks that first.
 *
 * There is exactly one owner per database. If one already exists (say, a real
 * owner who signed in with Google while it was configured), that owner is
 * used. Otherwise the dev owner is inserted directly: Better Auth's
 * before-create hook refuses any email that is not OWNER_EMAIL or invited, so
 * it cannot come through sign-up. The family row is created as for a real
 * owner.
 */
export async function ensureDevOwner(db?: Db): Promise<Member> {
  const conn = db ?? (await getDb());
  const existing = await findOwner(conn);
  if (existing) return existing;

  // Two first requests at once: the second insert hits the primary key or
  // the single-owner index and does nothing; both then read the same owner.
  await conn
    .insert(schema.user)
    .values({ ...DEV_OWNER, emailVerified: true, role: "owner" })
    .onConflictDoNothing();
  const owner = await findOwner(conn);
  if (!owner) throw new Error("Could not create the development owner.");
  await completeSignUp({ id: owner.id, email: owner.email, role: "owner" }, conn);
  return owner;
}

/**
 * The signed-in member, or null. Outside production with no Google client,
 * that is always the dev owner. In production with sign-in not configured,
 * it is always null, so nothing is accessible.
 */
export async function currentMember(): Promise<Member | null> {
  return memberForRequest(await headers());
}

/**
 * currentMember() for a request whose headers are passed in, for src/proxy.ts,
 * which has the request but cannot use next/headers. With sign-in configured
 * this looks the session up in the database through Better Auth (the cookie
 * cache is off), so a forged cookie, an expired session and the cookie of a
 * removed member all give null.
 */
export async function memberForRequest(requestHeaders: Headers): Promise<Member | null> {
  const mode = gateMode(process.env);
  if (mode === "dev-owner") return ensureDevOwner();
  if (mode === "closed") return null;

  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { id, name, email, role } = session.user;
  return { id, name, email, role: role as Role };
}

/** The signed-in member; throws NotSignedInError when there is none. */
export async function requireMember(): Promise<Member> {
  const member = await currentMember();
  if (!member) throw new NotSignedInError();
  return member;
}

/**
 * The signed-in member if they are the family's owner. Throws
 * NotSignedInError when nobody is signed in, and FamilyError("NOT_OWNER")
 * for a member. The role comes from the session lookup, which reads the user
 * row on every request (the cookie cache is off), so it is never stale.
 */
export async function requireOwner(): Promise<Member> {
  const member = await requireMember();
  if (member.role !== "owner") {
    throw new FamilyError("NOT_OWNER", "Only the family's owner can do that.");
  }
  return member;
}
