import { Suspense } from "react";
import { signOutAction, updateDisplayNameAction } from "@/app/account/actions";
import { gateMode, requireMember } from "@/lib/member";

export const metadata = { title: "My account" };

type SearchParams = Promise<{ saved?: string; error?: string }>;

/**
 * My account: who you are signed in as, your display name, passkeys (the
 * "Passkeys" task) and sign out. src/proxy.ts has already turned away anyone
 * who is not signed in; the member is read per request inside <Suspense>.
 */
export default function AccountPage(props: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">My account</h1>
      <Suspense fallback={<p className="text-stone-500">Loading your account…</p>}>
        <Account searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

const ROLE_LABEL = { owner: "Owner", member: "Member" } as const;

const NAME_ERRORS: Record<string, string> = {
  "name-empty": "Enter a name.",
  "name-long": "Keep it to 80 characters or fewer.",
};

async function Account({ searchParams }: { searchParams: SearchParams }) {
  const [member, params] = await Promise.all([requireMember(), searchParams]);
  const nameError = typeof params.error === "string" ? NAME_ERRORS[params.error] : undefined;
  const saved = params.saved === "name" && !nameError;
  const devOwner = gateMode(process.env) === "dev-owner";

  return (
    <>
      <section className="card space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-stone-500">Name</dt>
          <dd className="min-w-0 break-words font-medium">{member.name}</dd>
          <dt className="text-stone-500">Email</dt>
          <dd className="min-w-0 break-all">{member.email}</dd>
          <dt className="text-stone-500">Role</dt>
          <dd>{ROLE_LABEL[member.role]}</dd>
        </dl>

        <form action={updateDisplayNameAction} className="space-y-2">
          <label htmlFor="name" className="block text-sm font-medium">
            Display name
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="name"
              name="name"
              defaultValue={member.name}
              required
              maxLength={80}
              autoComplete="name"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "name-error" : saved ? "name-saved" : undefined}
              className="input min-h-11 text-base"
            />
            <button type="submit" className="btn btn-primary min-h-11 shrink-0">
              Save name
            </button>
          </div>
          {nameError && (
            <p id="name-error" role="alert" className="text-sm text-red-700">
              {nameError}
            </p>
          )}
          {saved && (
            <p id="name-saved" role="status" className="text-sm text-green-700">
              Name saved.
            </p>
          )}
        </form>
      </section>

      {/* Passkeys: the list and "Add a passkey" go in this section (the "Passkeys" task). */}
      <section aria-labelledby="passkeys-heading" className="card space-y-2">
        <h2 id="passkeys-heading" className="font-semibold">
          Passkeys
        </h2>
        <p className="text-sm text-stone-500">
          Sign in with Face ID or your fingerprint. Coming soon; for now, use Google.
        </p>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Sign out</h2>
        <p className="text-sm text-stone-500">
          {devOwner
            ? "Sign-in isn’t configured here, so you’re the built-in development owner and signing out brings you straight back."
            : "Signs you out on this device only. Your other devices stay signed in."}
        </p>
        <form action={signOutAction}>
          <button type="submit" className="btn btn-secondary min-h-11 w-full sm:w-auto">
            Sign out
          </button>
        </form>
      </section>
    </>
  );
}
