import { and, asc, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import type { Invitation, Role } from "@/db/schema";

/**
 * The family rules: who may become an account, and what the owner may do.
 *
 * There is one family per deployment. It is invite only: an account can be
 * created only for the configured owner email (while there is no owner yet)
 * or for an email with a pending invitation. Better Auth's before-create hook
 * in src/lib/auth.ts calls signUpRole() and refuses everything else.
 *
 * These are plain functions over the database with no Next.js request APIs,
 * so checks can call them against a temporary database. Each one takes an
 * optional database handle and falls back to getDb().
 */

/** The family's name until the owner renames it. */
export const DEFAULT_FAMILY_NAME = "Our family";

const MAX_NAME_LENGTH = 100;

export type FamilyErrorCode =
  | "NOT_OWNER"
  | "INVALID_NAME"
  | "INVALID_EMAIL"
  | "ALREADY_MEMBER"
  | "ALREADY_INVITED"
  | "INVITATION_NOT_FOUND"
  | "MEMBER_NOT_FOUND"
  | "CANNOT_REMOVE_OWNER";

/** A refused family action. `message` is safe to show to the person. */
export class FamilyError extends Error {
  constructor(
    readonly code: FamilyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FamilyError";
  }
}

/** The member doing something. Their role is always re-read from the database. */
export type Actor = { id: string };

export type FamilyMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
};

export type PendingInvitation = Pick<Invitation, "id" | "name" | "email" | "invitedBy" | "createdAt">;

export type FamilyOverview = {
  name: string;
  members: FamilyMember[];
  invitations: PendingInvitation[];
};

/** Emails are compared and stored lower-case, as Better Auth stores them. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * OWNER_EMAIL, normalised, or null when unset. With no owner email nobody can
 * become the owner, so in production an unset OWNER_EMAIL means only invited
 * emails can sign up, and before the owner exists nobody can.
 */
export function ownerEmail(): string | null {
  const email = process.env.OWNER_EMAIL;
  return email && email.trim() ? normalizeEmail(email) : null;
}

async function resolveDb(db?: Db): Promise<Db> {
  return db ?? (await getDb());
}

async function hasOwner(db: Db): Promise<boolean> {
  const rows = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.role, "owner"))
    .limit(1);
  return rows.length > 0;
}

async function isMemberEmail(db: Db, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  return rows.length > 0;
}

async function hasPendingInvitation(db: Db, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.invitations.id })
    .from(schema.invitations)
    .where(and(eq(schema.invitations.email, email), eq(schema.invitations.state, "pending")))
    .limit(1);
  return rows.length > 0;
}

/**
 * The role a new account for this email would get, or null if it may not
 * sign up. The owner email counts only while no owner exists; after that it is
 * treated like any other address, so changing OWNER_EMAIL later can never
 * create a second owner.
 */
export async function signUpRole(email: string, db?: Db): Promise<Role | null> {
  const conn = await resolveDb(db);
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const owner = ownerEmail();
  if (owner && normalized === owner && !(await hasOwner(conn))) return "owner";
  // An invitation whose email already belongs to someone is stale (its
  // acceptance did not complete), so it grants nothing.
  if ((await hasPendingInvitation(conn, normalized)) && !(await isMemberEmail(conn, normalized))) {
    return "member";
  }
  return null;
}

/** True only for the owner email (while there is no owner) or a pending invitation. */
export async function canSignUp(email: string, db?: Db): Promise<boolean> {
  return (await signUpRole(email, db)) !== null;
}

/**
 * Called after Better Auth has created a user (see src/lib/auth.ts). The owner
 * gets the family row; a member's invitation becomes accepted.
 *
 * Returns false if a member had no pending invitation left to accept, because
 * it was cancelled between the before-create check and now. That user is
 * deleted again (their linked account and sessions go with the row), and the
 * caller must refuse the sign-in.
 */
export async function completeSignUp(
  created: { id: string; email: string; role: Role },
  db?: Db,
): Promise<boolean> {
  const conn = await resolveDb(db);
  if (created.role === "owner") {
    await conn
      .insert(schema.family)
      .values({ id: 1, name: DEFAULT_FAMILY_NAME })
      .onConflictDoNothing({ target: schema.family.id });
    return true;
  }
  const accepted = await conn
    .update(schema.invitations)
    .set({ state: "accepted", updatedAt: new Date() })
    .where(
      and(
        eq(schema.invitations.email, normalizeEmail(created.email)),
        eq(schema.invitations.state, "pending"),
      ),
    )
    .returning();
  if (accepted.length > 0) return true;
  await conn
    .delete(schema.user)
    .where(and(eq(schema.user.id, created.id), eq(schema.user.role, "member")));
  return false;
}

/** Refuses anyone who is not, according to the database, the owner. */
async function requireOwnerActor(db: Db, actor: Actor): Promise<void> {
  const [row] = await db
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, actor.id))
    .limit(1);
  if (row?.role !== "owner") {
    throw new FamilyError("NOT_OWNER", "Only the family's owner can do that.");
  }
}

function cleanName(name: string, what: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new FamilyError("INVALID_NAME", `Enter ${what}.`);
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new FamilyError("INVALID_NAME", `Keep ${what} under ${MAX_NAME_LENGTH} characters.`);
  }
  return trimmed;
}

/** Deliberately loose: Google decides what a real address is. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Postgres unique_violation, as either driver reports it. */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/** Records an invitation. No email is sent. Owner only. */
export async function inviteMember(
  actor: Actor,
  input: { name: string; email: string },
  db?: Db,
): Promise<PendingInvitation> {
  const conn = await resolveDb(db);
  await requireOwnerActor(conn, actor);
  const name = cleanName(input.name, "their name");
  const email = normalizeEmail(input.email);
  if (!EMAIL_SHAPE.test(email)) {
    throw new FamilyError("INVALID_EMAIL", "Enter the email address of their Google account.");
  }

  if (await isMemberEmail(conn, email)) {
    throw new FamilyError("ALREADY_MEMBER", `${email} is already in the family.`);
  }
  const alreadyInvited = new FamilyError("ALREADY_INVITED", `${email} has already been invited.`);
  if (await hasPendingInvitation(conn, email)) throw alreadyInvited;

  try {
    const [row] = await conn
      .insert(schema.invitations)
      .values({ name, email, invitedBy: actor.id })
      .returning();
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      invitedBy: row.invitedBy,
      createdAt: row.createdAt,
    };
  } catch (err) {
    // Two invitations for the same email at once: the pending-email index
    // lets only one through.
    if (isUniqueViolation(err)) throw alreadyInvited;
    throw err;
  }
}

/** Cancels a pending invitation. Owner only. */
export async function cancelInvitation(actor: Actor, invitationId: string, db?: Db): Promise<void> {
  const conn = await resolveDb(db);
  await requireOwnerActor(conn, actor);
  const cancelled = await conn
    .update(schema.invitations)
    .set({ state: "cancelled", updatedAt: new Date() })
    .where(
      and(eq(schema.invitations.id, invitationId), eq(schema.invitations.state, "pending")),
    )
    .returning();
  if (cancelled.length === 0) {
    throw new FamilyError("INVITATION_NOT_FOUND", "That invitation is no longer pending.");
  }
}

/**
 * Removes a member: their sessions (so they are signed out on their next
 * request), their linked sign-in accounts, and their user row. Any other
 * table that references the user, including ones added later, goes with the
 * row through ON DELETE CASCADE. Owner only, and the owner can never be removed.
 */
export async function removeMember(actor: Actor, memberId: string, db?: Db): Promise<void> {
  const conn = await resolveDb(db);
  await requireOwnerActor(conn, actor);
  const [target] = await conn
    .select({ role: schema.user.role, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, memberId))
    .limit(1);
  if (!target) throw new FamilyError("MEMBER_NOT_FOUND", "That person is not in the family.");
  if (target.role === "owner") {
    throw new FamilyError("CANNOT_REMOVE_OWNER", "The family's owner cannot be removed.");
  }
  await conn.transaction(async (tx) => {
    // A pending invitation for their email would let them straight back in.
    await tx
      .update(schema.invitations)
      .set({ state: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(schema.invitations.email, normalizeEmail(target.email)),
          eq(schema.invitations.state, "pending"),
        ),
      );
    await tx.delete(schema.session).where(eq(schema.session.userId, memberId));
    await tx.delete(schema.account).where(eq(schema.account.userId, memberId));
    // The role condition guards against the row having changed in between.
    await tx
      .delete(schema.user)
      .where(and(eq(schema.user.id, memberId), eq(schema.user.role, "member")));
  });
}

/** Renames the family. Owner only. */
export async function renameFamily(actor: Actor, name: string, db?: Db): Promise<void> {
  const conn = await resolveDb(db);
  await requireOwnerActor(conn, actor);
  const cleaned = cleanName(name, "a family name");
  await conn
    .insert(schema.family)
    .values({ id: 1, name: cleaned })
    .onConflictDoUpdate({
      target: schema.family.id,
      set: { name: cleaned, updatedAt: new Date() },
    });
}

/** The family's name, its members (owner first) and its pending invitations. */
export async function listFamily(db?: Db): Promise<FamilyOverview> {
  const conn = await resolveDb(db);
  const [familyRow] = await conn
    .select({ name: schema.family.name })
    .from(schema.family)
    .where(eq(schema.family.id, 1))
    .limit(1);
  const users = await conn
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      joinedAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(asc(schema.user.createdAt));
  const members = [
    ...users.filter((u) => u.role === "owner"),
    ...users.filter((u) => u.role !== "owner"),
  ];
  const memberEmails = new Set(users.map((u) => u.email));
  const pending = await conn
    .select({
      id: schema.invitations.id,
      name: schema.invitations.name,
      email: schema.invitations.email,
      invitedBy: schema.invitations.invitedBy,
      createdAt: schema.invitations.createdAt,
    })
    .from(schema.invitations)
    .where(eq(schema.invitations.state, "pending"))
    .orderBy(asc(schema.invitations.createdAt));
  // A pending invitation for someone already in the family is stale; it
  // grants nothing (see signUpRole), so it is not shown as pending.
  const invitations = pending.filter((i) => !memberEmails.has(i.email));
  return { name: familyRow?.name ?? DEFAULT_FAMILY_NAME, members, invitations };
}
