import { getAuthenticatorName } from "@better-auth/passkey";
import { asc, eq } from "drizzle-orm";
import { Suspense } from "react";
import { signOutAction, updateDisplayNameAction } from "@/app/account/actions";
import { PasskeyList, type PasskeyItem } from "@/components/PasskeyList";
import { getDb, schema } from "@/db";
import { passkeyRelyingParty } from "@/lib/auth";
import { gateMode, requireMember, type Member } from "@/lib/member";

export const metadata = { title: "My account" };

type SearchParams = Promise<{ saved?: string; error?: string }>;

/**
 * My account: who you are signed in as, your display name, your passkeys
 * and sign out. src/proxy.ts has already turned away anyone
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

      <section aria-labelledby="passkeys-heading" className="card space-y-2">
        <h2 id="passkeys-heading" className="font-semibold">
          Passkeys
        </h2>
        <p className="text-sm text-stone-500">
          Sign in with Face ID, your fingerprint or your device&rsquo;s screen lock instead of
          Google. You can always still sign in with Google.
        </p>
        <Passkeys member={member} devOwner={devOwner} />
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

/**
 * The member's passkeys, read from the database. Only their own: the query is
 * by the signed-in member's id, as Better Auth's own list endpoint does.
 */
async function Passkeys({ member, devOwner }: { member: Member; devOwner: boolean }) {
  const party = passkeyRelyingParty();
  if (devOwner || !party) {
    return (
      <p className="text-sm text-stone-500">
        {devOwner
          ? "Passkeys need sign-in to be set up here, so they aren’t available to the development owner."
          : "Passkeys aren’t available on this site."}
      </p>
    );
  }
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.passkey.id,
      name: schema.passkey.name,
      aaguid: schema.passkey.aaguid,
      createdAt: schema.passkey.createdAt,
    })
    .from(schema.passkey)
    .where(eq(schema.passkey.userId, member.id))
    .orderBy(asc(schema.passkey.createdAt));
  const passkeys: PasskeyItem[] = rows.map((row) => ({
    id: row.id,
    label: row.name?.trim() || getAuthenticatorName(row.aaguid ?? undefined) || "Passkey",
    added: row.createdAt ? ADDED_DATE.format(row.createdAt) : "on an unknown date",
  }));
  return <PasskeyList passkeys={passkeys} rpID={party.rpID} />;
}

/** "11 Nov 2026": one fixed format, the same wherever the page renders. */
const ADDED_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
