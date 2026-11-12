// THROWAWAY SPIKE (prototype/vercel-connect-signin): shows what a Vercel Connect sign-in returned.
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb, schema } from "@/db";
import { getAuth } from "@/lib/auth";
import {
  SPIKE_CONNECTOR,
  SPIKE_PROVIDER_ID,
  spikeBaseURL,
  spikeCaptures,
  spikeForeignRedirectProbe,
} from "@/lib/spike-connect";
import { SpikeConnectButton } from "./SpikeConnectButton";

type SearchParams = Promise<{ error?: string; error_description?: string }>;

export default function SpikeConnectPage(props: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <SpikeConnect searchParams={props.searchParams} />
    </Suspense>
  );
}

function Json({ value }: { value: unknown }) {
  return <pre className="overflow-x-auto rounded bg-stone-100 p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

async function SpikeConnect({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const params = await searchParams;
  const requestHeaders = await headers();
  const db = await getDb();
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const accounts = session
    ? await db
        .select({
          providerId: schema.account.providerId,
          accountId: schema.account.accountId,
          scope: schema.account.scope,
          createdAt: schema.account.createdAt,
        })
        .from(schema.account)
        .where(eq(schema.account.userId, session.user.id))
    : [];
  const context = await auth.$context;
  const env = process.env;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Spike: Vercel Connect sign-in</h1>
      <p className="text-sm text-stone-500">Throwaway page on prototype/vercel-connect-signin.</p>
      {params.error && <Json value={{ error: params.error, error_description: params.error_description }} />}
      <SpikeConnectButton providerId={SPIKE_PROVIDER_ID} />
      <p className="text-sm">
        <a className="underline" href="/sign-in">Existing Google sign-in (socialProviders + proxy)</a>
        {" · "}
        <a className="underline" href={spikeForeignRedirectProbe()}>Probe: authorize with a foreign redirect_uri</a>
      </p>

      <h2 className="font-semibold">This request</h2>
      <Json
        value={{
          host: requestHeaders.get("host"),
          forwardedHost: requestHeaders.get("x-forwarded-host"),
          forwardedProto: requestHeaders.get("x-forwarded-proto"),
          connector: SPIKE_CONNECTOR,
          baseURLConfig: spikeBaseURL(env),
          contextBaseURL: context.baseURL,
          trustedOrigins: context.trustedOrigins,
          env: {
            VERCEL_ENV: env.VERCEL_ENV,
            VERCEL_URL: env.VERCEL_URL,
            VERCEL_BRANCH_URL: env.VERCEL_BRANCH_URL,
            BETTER_AUTH_URL: env.BETTER_AUTH_URL,
            OAUTH_PROXY_URL: env.OAUTH_PROXY_URL,
            hasVERCEL_OIDC_TOKEN: Boolean(env.VERCEL_OIDC_TOKEN),
            hasGOOGLE_CLIENT_ID: Boolean(env.GOOGLE_CLIENT_ID),
          },
        }}
      />

      <h2 className="font-semibold">Session</h2>
      <Json
        value={
          session
            ? { member: { id: session.user.id, email: session.user.email, name: session.user.name }, accounts }
            : "signed out"
        }
      />

      <h2 className="font-semibold">Last Connect captures (newest first)</h2>
      <Json value={await spikeCaptures(db)} />
    </div>
  );
}
