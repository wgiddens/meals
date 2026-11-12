/**
 * THROWAWAY SPIKE (branch prototype/vercel-connect-signin, never merged).
 *
 * Google sign-in through Vercel Connect's Better Auth adapter, next to the
 * existing Google socialProviders sign-in. Every Connect sign-in records what
 * came back (userinfo, ID token claims, the redirect_uri sent, the OIDC
 * token's non-secret claims) in the verification table so /spike/connect can
 * show it, even when the invite rule refuses the sign-up.
 */
import { randomUUID } from "node:crypto";
import { connect } from "@vercel/connect/betterauth";
import type { BetterAuthPlugin } from "better-auth";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { getVercelOidcToken } from "@vercel/oidc";
import { desc, like } from "drizzle-orm";
import { schema, type Db } from "@/db";

export const SPIKE_PROVIDER_ID = "vercel-connect-google";
export const SPIKE_CONNECTOR = process.env.SPIKE_CONNECTOR?.trim() || "google/meals-google-spike";
const CAPTURE_PREFIX = "spike-connect:";

export type SpikeCapture = { at: string; kind: string; [key: string]: unknown };

function jwtClaims(jwt: string | undefined): Record<string, unknown> | null {
  const payload = jwt?.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** The OIDC token's claims that say who is asking, never the token itself. */
function oidcSummary(token: string): Record<string, unknown> {
  const claims = jwtClaims(token) ?? {};
  const keep = ["iss", "aud", "sub", "owner", "project", "environment", "exp", "iat"];
  const summary = Object.fromEntries(keep.filter((k) => k in claims).map((k) => [k, claims[k]]));
  if (typeof claims.exp === "number") summary.expiresAt = new Date(claims.exp * 1000).toISOString();
  return summary;
}

async function capture(db: Db, kind: string, details: Record<string, unknown>): Promise<void> {
  const now = new Date();
  const value: SpikeCapture = { at: now.toISOString(), kind, ...details };
  try {
    await db.insert(schema.verification).values({
      id: randomUUID(),
      identifier: `${CAPTURE_PREFIX}${now.toISOString()}:${kind}`,
      value: JSON.stringify(value),
      expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    });
  } catch (error) {
    console.error("spike capture failed", error);
  }
  console.log("[spike-connect]", JSON.stringify(value));
}

export async function spikeCaptures(db: Db, limit = 20): Promise<SpikeCapture[]> {
  const rows = await db
    .select({ value: schema.verification.value })
    .from(schema.verification)
    .where(like(schema.verification.identifier, `${CAPTURE_PREFIX}%`))
    .orderBy(desc(schema.verification.createdAt))
    .limit(limit);
  return rows.map((row) => JSON.parse(row.value) as SpikeCapture);
}

export function spikeConnectPlugin(db: Db): BetterAuthPlugin {
  const config = connect({ providerId: SPIKE_PROVIDER_ID, connector: SPIKE_CONNECTOR });
  const adapterGetToken = config.getToken!;
  return genericOAuth({
    config: [
      {
        ...config,
        getToken: async (data) => {
          let oidc: Record<string, unknown> = {};
          try {
            oidc = oidcSummary(await getVercelOidcToken());
          } catch (error) {
            oidc = { error: String(error) };
          }
          try {
            const tokens = await adapterGetToken(data);
            await capture(db, "token", {
              redirectURI: data.redirectURI,
              oidc,
              tokenFields: Object.keys(tokens).filter((k) => tokens[k as keyof typeof tokens] !== undefined),
              scopes: tokens.scopes,
              idTokenClaims: jwtClaims(tokens.idToken),
              accessTokenClaims: jwtClaims(tokens.accessToken),
            });
            return tokens;
          } catch (error) {
            await capture(db, "token-error", { redirectURI: data.redirectURI, oidc, error: String(error) });
            throw error;
          }
        },
        // Same mapping as the adapter, but keeps the raw userinfo response.
        getUserInfo: async (tokens) => {
          const response = await fetch("https://connect.vercel.com/oauth/userinfo", {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          });
          const body = await response.text();
          let userinfo: Record<string, unknown> = {};
          try {
            userinfo = JSON.parse(body);
          } catch {
            userinfo = { unparsed: body.slice(0, 500) };
          }
          await capture(db, "userinfo", { status: response.status, userinfo });
          if (!response.ok) return null;
          return {
            id: String(userinfo.sub),
            email: userinfo.email as string,
            emailVerified: (userinfo.email_verified as boolean | undefined) ?? false,
            name: userinfo.name as string,
            image: userinfo.picture as string | undefined,
          };
        },
      },
    ],
  });
}

/**
 * On previews and locally, resolve Better Auth's base URL from the request's
 * own host (only this deployment's addresses), so the redirect_uri sent to
 * Connect is this deployment's callback, not BETTER_AUTH_URL's fixed preview.
 * Production keeps its static BETTER_AUTH_URL.
 */
export function spikeBaseURL(env: Readonly<Record<string, string | undefined>>) {
  const configured = env.BETTER_AUTH_URL?.trim() || undefined;
  if (env.VERCEL_ENV === "production") return configured;
  const hosts = [env.VERCEL_URL, env.VERCEL_BRANCH_URL]
    .map((value) => value?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((host): host is string => Boolean(host));
  return {
    allowedHosts: [...hosts, "localhost:*", "127.0.0.1:*"],
    fallback: configured,
  };
}

/** An authorize request whose redirect_uri is a foreign origin: does Connect refuse it? */
export function spikeForeignRedirectProbe(): string {
  const { authorizationUrl } = connect({ providerId: SPIKE_PROVIDER_ID, connector: SPIKE_CONNECTOR });
  const url = new URL(authorizationUrl!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", SPIKE_CONNECTOR);
  url.searchParams.set("redirect_uri", "https://example.com/spike-foreign-redirect-probe");
  url.searchParams.set("scope", "openid email profile offline_access");
  url.searchParams.set("state", "spike-probe");
  url.searchParams.set("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
