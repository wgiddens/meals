"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkPasscode,
  clearFailedAttempts,
  isLockedOut,
  issueSessionToken,
  noteFailedAttempt,
  safeReturnPath,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/household";

/** Sign in and sign out for the household passcode gate (see src/lib/household.ts). */

export type SignInState = { error?: string } | null;

async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const passcode = String(formData.get("passcode") ?? "");
  if (!passcode.trim()) return { error: "Enter the household passcode" };

  const ip = await clientIp();
  if (isLockedOut(ip)) return { error: "Too many tries. Wait a few minutes and try again." };
  if (!(await checkPasscode(passcode))) {
    await noteFailedAttempt(ip);
    return { error: "That isn't the passcode" };
  }
  clearFailedAttempts(ip);

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
