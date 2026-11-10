"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  cancelInvitation,
  FamilyError,
  inviteMember,
  removeMember,
  renameFamily,
} from "@/lib/family";
import { requireOwner } from "@/lib/member";

/**
 * The family page's Server Actions. Every one starts with requireOwner(), so a
 * member (or anyone signed out) who posts to one directly is refused with a
 * thrown error before anything is read from the form. The rules themselves
 * live in src/lib/family.ts, which checks the owner again from the database.
 *
 * A refusal from the rules (a FamilyError, such as ALREADY_INVITED) comes back
 * as `error` for the form to show; anything else is a real failure and is
 * thrown.
 */

type FormResult = {
  error?: string;
  /** What was typed, so a refused form keeps it. */
  values?: Record<string, string>;
};

export type FamilyFormState = FormResult | null;

export type InviteFormState =
  | (FormResult & { invited?: undefined })
  | { invited: { name: string; email: string }; error?: undefined; values?: undefined }
  | null;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The FamilyError's message, or rethrows anything else. */
function ruleError(err: unknown): string {
  if (err instanceof FamilyError) return err.message;
  throw err;
}

export async function inviteMemberAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const owner = await requireOwner();
  const name = field(formData, "name");
  const email = field(formData, "email");
  try {
    const invitation = await inviteMember(owner, { name, email });
    revalidatePath("/family");
    return { invited: { name: invitation.name, email: invitation.email } };
  } catch (err) {
    return { error: ruleError(err), values: { name, email } };
  }
}

export async function cancelInvitationAction(
  _prev: FamilyFormState,
  formData: FormData,
): Promise<FamilyFormState> {
  const owner = await requireOwner();
  const invitationId = field(formData, "invitationId");
  // The id column is a uuid; anything else could never match a pending row.
  if (!z.uuid().safeParse(invitationId).success) {
    return { error: "That invitation is no longer pending." };
  }
  try {
    await cancelInvitation(owner, invitationId);
  } catch (err) {
    return { error: ruleError(err) };
  } finally {
    // Refresh either way: a refusal usually means the list is out of date.
    revalidatePath("/family");
  }
  return null;
}

export async function removeMemberAction(
  _prev: FamilyFormState,
  formData: FormData,
): Promise<FamilyFormState> {
  const owner = await requireOwner();
  try {
    await removeMember(owner, field(formData, "memberId"));
  } catch (err) {
    return { error: ruleError(err) };
  } finally {
    revalidatePath("/family");
  }
  return null;
}

export async function renameFamilyAction(
  _prev: FamilyFormState,
  formData: FormData,
): Promise<FamilyFormState> {
  const owner = await requireOwner();
  const name = field(formData, "name");
  try {
    await renameFamily(owner, name);
  } catch (err) {
    return { error: ruleError(err), values: { name } };
  }
  revalidatePath("/family");
  return null;
}
