import { signOutAction } from "@/app/auth-actions";
import { isGateEnabled, isSignedIn } from "@/lib/household";

/** Footer link to clear the household session. Renders nothing when the gate is off. */
export async function SignOutLink() {
  const signedIn = await isSignedIn();
  if (!isGateEnabled() || !signedIn) return null;
  return (
    <form action={signOutAction} className="inline">
      <button className="underline hover:text-stone-600">Sign out</button>
    </form>
  );
}
