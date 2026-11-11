---
issue: 13
stream: All streams in 13-analysis.md, in order
started: 2026-11-11T02:39:38Z
status: completed
---
## Scope
Every stream in `13-analysis.md`, done in order by one implementer.
## Progress
- A: `passkey` table in `src/db/schema.ts` (cascade from `user`, unique
  `credential_id`), migration `drizzle/0003_passkeys.sql`. `src/lib/auth.ts`
  loads `@better-auth/passkey` with `passkeyRelyingParty(env)`: production
  and local use `BETTER_AUTH_URL` (local falls back to `localhost`), a preview
  uses its own `VERCEL_BRANCH_URL` (option A, the stakeholder's choice),
  production without `BETTER_AUTH_URL` turns passkeys off. The origin is set
  explicitly, so trusted origins never widen it. Registration requires a
  session (and a fresh one, Better Auth's one-day `freshAge`).
- B: `passkeyClient()` in `src/lib/auth-client.ts`.
  `src/components/PasskeySupport.tsx` (WebAuthn present and hostname equals
  the rpID), `PasskeyList.tsx` (list with name and added date, add, remove)
  on `/account`, and `PasskeySignInButton.tsx` ("Use a passkey") on
  `/sign-in`.
- C: `scripts/check-accounts.ts` sections [11] and [12]. A software
  authenticator runs the real ceremonies through Better Auth's handler, on
  the local instance and on preview and production instances.
- Browser check with Playwright's virtual authenticator against
  `next start`: see progress.md.
- Review fixes (PR #25, findings 1, 3 and 4): `PasskeyList` registers with
  no `name`, so the WebAuthn user stays the member's email, then labels the
  stored passkey with `updatePasskey` (check 11.1b). Cancelling the sign-in
  prompt (`ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY`) shows "cancelled". The
  stale-session message no longer says "with Google". Findings 2 and 5 are
  on hold for the stakeholder.
