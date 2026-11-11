"use server";

import { eq } from "drizzle-orm";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { getAuth } from "@/lib/auth";
import { gateMode, requireMember } from "@/lib/member";

/**
 * My account's Server Actions. Each starts with requireMember(): the member
 * acts only on their own account, identified by the session, never by
 * anything in the form. scripts/smoke.ts fails if one does not start this way.
 *
 * Both are plain form actions, so they work before the page's JavaScript has
 * loaded. The outcome travels back in the /account query string.
 */

/** The longest display name allowed, in characters. */
const MAX_NAME_LENGTH = 80;

/**
 * The display name from the form: trimmed, inner runs of whitespace (including
 * line breaks) collapsed to one space, between 1 and 80 characters. Returns
 * the reason code for /account when it is not acceptable.
 */
function parseDisplayName(value: FormDataEntryValue | null): { name: string } | { error: string } {
  if (typeof value !== "string") return { error: "name-empty" };
  const name = value.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
  if (name.length === 0) return { error: "name-empty" };
  if ([...name].length > MAX_NAME_LENGTH) return { error: "name-long" };
  return { name };
}

/** Changes the signed-in member's display name. */
export async function updateDisplayNameAction(formData: FormData) {
  const member = await requireMember();
  const parsed = parseDisplayName(formData.get("name"));
  if ("error" in parsed) redirect(`/account?error=${parsed.error}`);

  const db = await getDb();
  await db
    .update(schema.user)
    .set({ name: parsed.name, updatedAt: new Date() })
    .where(eq(schema.user.id, member.id));
  // The name shows wherever the member does (the family page, too).
  revalidatePath("/", "layout");
  redirect("/account?saved=name");
}

/**
 * Signs out on this device: Better Auth deletes this session's row and
 * expires its cookie, then the member is sent to /sign-in. Other devices stay
 * signed in. In local development without Google there is no session to end;
 * everyone is the dev owner, so /sign-in sends them straight back.
 */
export async function signOutAction() {
  await requireMember();
  if (gateMode(process.env) === "sign-in") {
    const auth = await getAuth();
    const { headers: responseHeaders } = await auth.api.signOut({
      headers: await headers(),
      returnHeaders: true,
    });
    // auth.api returns Better Auth's cookies rather than setting them; pass
    // the expired session cookie on to the browser.
    const jar = await cookies();
    for (const setCookie of responseHeaders.getSetCookie()) {
      for (const [name, attributes] of parseSetCookieHeader(setCookie)) {
        jar.set(name, attributes.value, toCookieOptions(attributes));
      }
    }
  }
  redirect("/sign-in");
}
