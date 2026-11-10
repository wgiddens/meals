import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, schema } from "@/db";

/**
 * Accounts and sign-in, provided by Better Auth and stored in our own
 * Postgres through Drizzle.
 *
 * The instance is built on first use rather than at module load, for the same
 * reason as getDb(): the database handle is async and, inside Next.js, only
 * exists once a request has arrived. Never call getAuth() at module scope.
 */

/** 90 days, so a family phone stays signed in. */
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
/** Push the expiry forward at most once a day while the session is in use. */
const SESSION_REFRESH_SECONDS = 24 * 60 * 60;

/** Only for local development and checks. Production must set its own. */
const DEVELOPMENT_SECRET = "meals-development-secret-do-not-use-in-production";

function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is not set. Sign-in is disabled until it is.");
  }
  return DEVELOPMENT_SECRET;
}

/** Google sign-in is offered only when both halves of the client are set. */
export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function createAuth() {
  const db = await getDb();
  const google = googleConfig();
  return betterAuth({
    secret: authSecret(),
    baseURL: process.env.BETTER_AUTH_URL?.trim() || undefined,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    // No passwords: people sign in with Google (and, later, passkeys).
    emailAndPassword: { enabled: false },
    socialProviders: google ? { google } : {},
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      // Every request looks the session up in the database, so removing a
      // member takes effect on their very next request.
      cookieCache: { enabled: false },
    },
  });
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

declare global {
  var __mealsAuth: Promise<Auth> | undefined;
}

/** Returns the shared Better Auth instance, creating it on first call. */
export async function getAuth(): Promise<Auth> {
  // Cached on globalThis so Next.js dev hot-reloads reuse one instance.
  if (!globalThis.__mealsAuth) {
    globalThis.__mealsAuth = createAuth().catch((err) => {
      globalThis.__mealsAuth = undefined;
      throw err;
    });
  }
  return globalThis.__mealsAuth;
}
