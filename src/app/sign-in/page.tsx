import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { currentMember, gateMode, safeReturnPath } from "@/lib/member";

export const metadata = { title: "Sign in" };

/**
 * Placeholder sign-in page. The real one, with "Continue with Google", comes
 * with the "Sign-in page with Google, sign out and My account" task. This one
 * only sends a signed-in visitor on and shows the not-configured state.
 */
export default function SignInPage(props: { searchParams: Promise<{ next?: string }> }) {
  return (
    <Suspense fallback={null}>
      <SignIn searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // The configuration is read per request, never baked in at build time.
  await connection();
  const next = safeReturnPath((await searchParams).next);
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

  return (
    <div className="card mx-auto mt-10 max-w-sm space-y-2">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="text-sm text-stone-500">Sign-in with Google is on its way.</p>
    </div>
  );
}
