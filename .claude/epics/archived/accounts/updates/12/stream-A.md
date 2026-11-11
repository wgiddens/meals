---
issue: 12
stream: All streams in 12-analysis.md, in order
started: 2026-11-10T21:41:08Z
status: completed
---
## Scope
Every stream in `12-analysis.md`, done in order by one implementer.
## Progress
- A: `src/lib/auth-client.ts` (Better Auth React client, no baseURL so it
  uses the page's own origin). `src/lib/auth.ts`: `oAuthProxy` when
  `OAUTH_PROXY_URL` is set (optional `OAUTH_PROXY_SECRET`), exported
  `trustedOrigins(env)` and `oauthProxyOrigin(env)`, and
  `onAPIError.errorURL = "/sign-in"`. `.env.example` documents both new
  variables.
- B: `src/components/GoogleSignInButton.tsx` and the real `/sign-in`:
  Google button, fixed messages for `?error=` codes (`NOT_INVITED` first),
  not-configured state and signed-in redirect kept from #11, passkey slot.
- C: `/account` (name, email, role; display name form; passkeys section;
  sign out) and `src/app/account/actions.ts` (`updateDisplayNameAction`,
  `signOutAction`, both starting with `await requireMember()`).
- Checks and hand checks: see progress.md.
- Review fixes (PR #24): hand-backs refused on the fixed deployment and
  production; `OAUTH_PROXY_SECRET` required and distinct; hand-backs bound to
  the starting browser; implicit account linking off; check:auth covers
  trusted origins, linking and the proxy end to end. See progress.md.
