import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { currentMember, gateMode, safeReturnPath } from "@/lib/member";

export const metadata = { title: "Sign in" };

type SearchParams = Promise<{ next?: string; error?: string }>;

/**
 * Sign in with Google (and, with the "Passkeys" task, a passkey). Signed-in
 * visitors, and everyone in local development without Google configured
 * (the dev owner), are sent straight on to `next`, or `/`.
 */
export default function SignInPage(props: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="mt-10 text-center text-stone-500">Loading…</p>}>
      <SignIn searchParams={props.searchParams} />
    </Suspense>
  );
}

/**
 * Why a sign-in came back. Better Auth's callback redirects here with
 * `?error=<code>`: our own codes from the invite-only hook in src/lib/auth.ts,
 * or OAuth ones such as `access_denied` when the person cancels at Google.
 * Only fixed messages are shown, never the raw code or description.
 */
function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "NOT_INVITED":
      return "This account hasn’t been invited. Ask the family’s owner to invite the email address you used.";
    case "EMAIL_NOT_VERIFIED":
    case "email_not_verified":
      return "Google hasn’t verified this account’s email address, so it can’t be used to sign in.";
    case "account_not_linked":
      return "This isn’t the Google account you first signed in with for this email address. Use that one, or ask the family’s owner to remove and re-invite you.";
    case "access_denied":
      return "Sign-in was cancelled.";
    default:
      return "Sign-in didn’t work. Please try again.";
  }
}

async function SignIn({ searchParams }: { searchParams: SearchParams }) {
  // The configuration is read per request, never baked in at build time.
  await connection();
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const mode = gateMode(process.env);

  if (mode === "closed") {
    return (
      <div className="card mx-auto mt-10 max-w-sm space-y-2">
        <h1 className="text-xl font-semibold">Sign-in isn&rsquo;t set up yet</h1>
        <p className="text-sm text-stone-500">
          This app isn&rsquo;t configured for sign-in, so nothing is available. The owner needs to
          finish setting it up.
        </p>
      </div>
    );
  }

  // The dev owner, or already signed in: nothing to do here.
  if (await currentMember()) redirect(next);

  const error = errorMessage(typeof params.error === "string" ? params.error : undefined);
  return (
    <SignInCard>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <GoogleSignInButton next={next} />
      {/* Passkeys: the "Use a passkey" button goes here (the "Passkeys" task). */}
    </SignInCard>
  );
}

function SignInCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="card mx-auto mt-10 max-w-sm space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-sm text-stone-500">Family members only.</p>
      </div>
      {children}
    </div>
  );
}
