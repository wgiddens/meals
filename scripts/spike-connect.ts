/**
 * SPIKE (vercel-connect-auth): what can be checked about Google sign-in
 * through Vercel Connect without a real Vercel deployment or Google account.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/spike-connect.ts
 *
 * On a simulated preview with VERCEL_CONNECT_GOOGLE set, starting sign-in on
 * either of the deployment's addresses (per-deployment and branch) sends the
 * browser to connect.vercel.com with a callback on THAT address. An address
 * that isn't the deployment's own is refused. Production ignores the
 * connector. ID-token sign-in is refused for the Connect provider. Throwaway
 * PGlite; no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meals-connect-spike-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.on("exit", () => fs.rmSync(dataDir, { recursive: true, force: true }));
for (const name of ["DATABASE_URL", "BETTER_AUTH_URL", "OAUTH_PROXY_URL", "OAUTH_PROXY_SECRET", "NEXT_RUNTIME"]) {
  delete process.env[name];
}
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = "production";
env.VERCEL_ENV = "preview";
env.VERCEL_URL = "meals-abc123-team.vercel.app";
env.VERCEL_BRANCH_URL = "meals-git-claude-spike-vercel-connect-team.vercel.app";
env.VERCEL_CONNECT_GOOGLE = "oauth/meals-google-spike";
env.BETTER_AUTH_SECRET = "spike-secret-spike-secret-spike-secret";
env.GOOGLE_CLIENT_ID = "preview-client";
env.GOOGLE_CLIENT_SECRET = "preview-secret";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}

async function startSignIn(handler: (r: Request) => Promise<Response>, host: string, body: object) {
  const origin = `https://${host}`;
  return handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, host },
      body: JSON.stringify(body),
    }),
  );
}

async function main() {
  const { getAuth, connectGoogleConnector, CONNECT_GOOGLE_PROVIDER_ID } = await import("@/lib/auth");
  const { gateMode } = await import("@/lib/gate");

  assert(connectGoogleConnector() === "oauth/meals-google-spike", "on a preview the connector is used");
  assert(
    connectGoogleConnector({ ...env, VERCEL_ENV: "production" }) === null,
    "in production the connector is ignored",
  );
  assert(
    gateMode({ NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_CONNECT_GOOGLE: "x", BETTER_AUTH_SECRET: "s" }) ===
      "closed",
    "production's gate does not count the connector",
  );
  assert(
    gateMode({ NODE_ENV: "development", VERCEL_ENV: "development", VERCEL_CONNECT_GOOGLE: "x" }) === "sign-in",
    "a vercel-env-pulled local run with the connector requires sign-in",
  );
  assert(gateMode({ NODE_ENV: "development" }) === "dev-owner", "a plain local run is still the dev owner");

  const auth = await getAuth();
  for (const host of [env.VERCEL_URL!, env.VERCEL_BRANCH_URL!]) {
    const res = await startSignIn(auth.handler, host, {
      provider: CONNECT_GOOGLE_PROVIDER_ID,
      callbackURL: `https://${host}/`,
      errorCallbackURL: `https://${host}/sign-in`,
    });
    const json = (await res.json()) as { url?: string };
    assert(res.status === 200 && typeof json.url === "string", `sign-in starts on ${host}`);
    const url = new URL(json.url!);
    assert(url.origin + url.pathname === "https://connect.vercel.com/oauth/authorize", "it goes to Connect's gateway");
    assert(url.searchParams.get("client_id") === "oauth/meals-google-spike", "with the connector as client_id");
    assert(
      url.searchParams.get("redirect_uri") === `https://${host}/api/auth/callback/${CONNECT_GOOGLE_PROVIDER_ID}`,
      `and a callback on ${host} itself, no fixed proxy`,
    );
    assert(url.searchParams.get("code_challenge_method") === "S256", "with PKCE");
    assert((url.searchParams.get("scope") ?? "").split(" ").includes("offline_access"), "scope includes offline_access");
  }

  const foreign = await startSignIn(auth.handler, "evil.example", {
    provider: CONNECT_GOOGLE_PROVIDER_ID,
    callbackURL: "https://evil.example/",
  }).catch((err: unknown) => err);
  const refused = foreign instanceof Error || (foreign instanceof Response && foreign.status >= 400);
  assert(refused, "a request on an address that isn't this deployment's is refused");

  const idToken = await startSignIn(auth.handler, env.VERCEL_URL!, {
    provider: CONNECT_GOOGLE_PROVIDER_ID,
    idToken: { token: "x.y.z" },
  });
  assert(idToken.status >= 400, `ID-token sign-in is refused for the Connect provider (got ${idToken.status})`);

  console.log("Connect spike checks passed.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
