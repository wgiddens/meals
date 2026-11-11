import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

/**
 * Better Auth's client, for the few things that must run in the browser:
 * starting Google sign-in (which ends in a full-page redirect to Google), and
 * the passkey ceremonies, which need the browser's WebAuthn API: adding and
 * removing a passkey on /account, and signing in with one on /sign-in.
 *
 * No baseURL: the client talks to /api/auth on whatever address the page was
 * loaded from, so the same build works on localhost, on each Vercel preview
 * and in production. Server code never uses this; it calls getAuth().
 */
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
