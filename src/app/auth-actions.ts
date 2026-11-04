"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkPasscode,
  issueSessionToken,
  safeReturnPath,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/household";

/** Sign in and sign out for the household passcode gate (see src/lib/household.ts). */

export type SignInState = { error?: string } | null;

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const passcode = String(formData.get("passcode") ?? "");
  if (!passcode.trim()) return { error: "Enter the household passcode" };
  if (!(await checkPasscode(passcode))) return { error: "That isn't the passcode" };

  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: await issueSessionToken(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect(safeReturnPath(formData.get("next")));
}

export async function signOutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
