---
name: vercel-connect-auth
status: backlog
created: 2026-11-11T16:04:34Z
updated: 2026-11-11T16:04:34Z
progress: 0%
prd: .claude/prds/vercel-connect-auth.md
github: (will be set on sync)
---

# Epic: vercel-connect-auth

## Overview

Move Google sign-in, in every environment, from Better Auth's built-in
Google provider (our own client and secret per environment, plus the OAuth
proxy for previews) to Vercel Connect's Better Auth adapter. Google then has
one redirect URI, `https://connect.vercel.com/callback`, and every deployment
receives its own callback. The OAuth proxy, its guards, `auth-proxy` and the
`OAUTH_PROXY_*` variables are removed. Sessions become effectively
indefinite. Existing members are reset and re-invited once
(stakeholder's decision, 2026-11-11).

The spike on `claude/spike-vercel-connect` (commits `efb960f`, `57fc2d4`) is
the reference for the wiring. Its code isn't merged: it ran Connect beside
the old provider under the id `google-connect`, which this epic does not.

## Architecture Decisions

### Connect replaces the built-in Google provider, under the id `google`
`genericOAuth({ config: [connect({ providerId: "google", connector })] })`,
with `connector` from `VERCEL_CONNECT_GOOGLE`. Better Auth's
`socialProviders.google` and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
go. The sign-in button keeps calling `authClient.signIn.social({ provider:
"google" })`: in Better Auth 1.7, `genericOAuth` providers are ordinary
social providers, and the callback is `/api/auth/callback/google` (not the
`/oauth2/...` paths Vercel's docs show for older Better Auth).
`genericOAuth` warns that `google` shadows a built-in provider; that is
expected, since the built-in one is no longer configured.

- Rejected: keeping both providers. Two sign-in paths to secure and test.
- Rejected: migrating account rows to the new provider. The stakeholder
  chose a reset and re-invite; the reset also removes every old `google`
  row, so the reused id can't match a stale link.

### Base URL from the request, limited to this deployment's own addresses
`baseURL: { allowedHosts: [...] }` (Better Auth's dynamic base URL), built
from the environment only, never from the request:

| Environment | Allowed hosts |
| --- | --- |
| Production (`VERCEL_ENV=production`) | the host of `BETTER_AUTH_URL` (later also `meals.giddens.app`, by `custom-domain`) |
| Preview | `VERCEL_URL` and `VERCEL_BRANCH_URL` |
| Not production (`NODE_ENV`) | also `localhost:*` and `127.0.0.1:*` |

No wildcard such as `*.vercel.app`. A request on any other host fails. This
is what lets Connect return to the address sign-in started on, with no
fixed proxy. `trustedOrigins()` keeps today's rules minus the proxy origin.

### The OAuth proxy is removed entirely
`oAuthProxy`, `oauthProxyRole()`, `oauthProxyOrigin()`,
`oauthProxySecret()`, `previewOriginPattern()`,
`proxyDestinationAllowed()`, the three guard plugins and their checks in
`scripts/check-auth.ts` all go. Production no longer needs the
"refuse hand-backs" layer, because no hand-back endpoint is mounted.

### The gate keys on the connector
`gateMode()` (`src/lib/gate.ts`) treats "Google configured" as
`VERCEL_CONNECT_GOOGLE` set. Production with the connector UID or
`BETTER_AUTH_SECRET` missing stays `closed`. Outside production with no
connector, everyone is the dev owner, so `npm run dev` and CI need nothing.

### Sessions last 400 days and renew daily
`expiresIn` 400 days (the most a browser keeps a cookie), `updateAge` one
day. A device that keeps using the app never signs out. The cookie cache
stays off, so removing a member still signs them out on their next request.
This replaces accounts' 90-day lifetime (stakeholder, 2026-11-11).

### One-off reset, run by the owner
`scripts/reset-accounts.ts` deletes every row of `user` in the database
`DATABASE_URL` points at. Sessions, account links and invitations cascade.
The `family` row and all meals data stay. The owner's first sign-in through
Connect recreates them as owner through the existing `OWNER_EMAIL`
bootstrap (the family insert is `onConflictDoNothing`, so the family keeps
its name). The owner then re-invites members from `/family`.

Safety: it refuses to run unless `--confirm-host=<host>` equals the host of
`DATABASE_URL`. It prints only that host, the database name and the row
counts, never the URL. It asks for nothing interactively. It is run by the
stakeholder, never by an agent, once on Preview's database and once on
Production's.

### Connect errors stay on the server
`onAPIError.onError` logs a `ConnectError`'s `code`, `status` and
`statusText` only, never `vendor`. The sign-in page shows a generic message
for `oauth_code_verification_failed`, which Better Auth sends when the code
exchange through Connect fails.

## Technical Approach

### Frontend Components
- `src/app/sign-in/page.tsx`: add a message for
  `oauth_code_verification_failed`. The Google button is unchanged.
- `src/components/GoogleSignInButton.tsx`: rewrite its comment (no proxy).

### Backend Services
- `src/lib/auth.ts`: Connect provider, dynamic base URL, proxy removed,
  400-day sessions, `ConnectError` logging. `googleConfig()` becomes a
  connector check.
- `src/lib/gate.ts`: key on `VERCEL_CONNECT_GOOGLE`.
- `scripts/check-auth.ts`, `scripts/check-accounts.ts`, `scripts/smoke.ts`:
  drop the proxy checks; add the spike's offline checks (sign-in started
  on each allowed host goes to `connect.vercel.com` with a callback on that
  host, a foreign host is refused, ID-token sign-in is refused); assert the
  session lifetime; the gate table uses the new variable. All run with no
  network: the Connect URLs are only built, never fetched.
- `scripts/reset-accounts.ts`: new, not part of `npm run smoke`, with a
  small check that its host guard refuses a mismatch.

### Infrastructure
- **Package:** `@vercel/connect` (exact version, 2.9.1 or the latest at the
  time; re-read its `betterauth` source first).
- **Google Cloud:** a production OAuth client whose only redirect URI is
  `https://connect.vercel.com/callback`. The spike's `meals-connect-spike`
  client is reused for Preview and Development. The old production and
  preview clients are deleted after the switch.
- **Vercel Connect:** a production connector linked to Production only. The
  spike's `google/meals-google-spike` connector is relinked to Preview and
  Development (or replaced by a renamed one).
- **Vercel variables:** `VERCEL_CONNECT_GOOGLE` per environment. Delete
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_PROXY_URL`,
  `OAUTH_PROXY_SECRET`, `OAUTH_PROXY_PREVIEW_PATTERN`, and Preview's
  `BETTER_AUTH_URL` (and the spike branch's override). Production keeps
  `BETTER_AUTH_URL` (its allowed host), `BETTER_AUTH_SECRET` and
  `OWNER_EMAIL`.
- **OIDC federation:** on (Team issuer). Already done in the spike.
- **CI:** no new secrets.

## Implementation Strategy

1. **Swap the provider and remove the proxy in one step**, so the app is
   never on two Google paths at once. Every check passes offline.
2. **Sessions and the reset script** are small and can run beside step 1
   once their files don't overlap (the reset script is a new file;
   sessions touch `auth.ts` and so wait for step 1).
3. **Docs before the switch**, so the stakeholder's checklist exists when
   the epic PR is ready.
4. **The switch is ordered** to avoid closing production:
   1. create the production client and connector, and set Production's
      `VERCEL_CONNECT_GOOGLE` before the epic merges (old code ignores it);
   2. merge the epic and deploy;
   3. run the reset on Production;
   4. the owner signs in, re-invites everyone;
   5. delete the old variables and Google clients.

   Preview follows the same order on its own database.
5. **Follow `AGENTS.md`:** read the bundled Next.js docs before touching
   pages; read the installed `better-auth` and `@vercel/connect` sources for
   APIs, not memory.

Risks:
- **Treated as proven, not yet seen** (stakeholder's call): `email_verified`
  true through Connect, invited/uninvited outcomes, the per-deployment
  preview address, billing per sign-in. Task 5's hand check covers each. If
  `email_verified` arrives false, sign-up fails closed with
  `EMAIL_NOT_VERIFIED`; the epic then stops for a decision before the
  production reset.
- **Connect sends `prompt=consent` and stores refresh tokens.** Accepted.
  Task 5 tries to remove both in the connector and records the outcome.
- **Base URL resolution depends on the `host` header.** Vercel sets it;
  the allowlist is what keeps a forged host from being used. Covered by the
  offline check.

## Task Breakdown Preview

| # | Task | Depends on | Parallel |
|---|---|---|---|
| 1 | Google sign-in through Connect: `@vercel/connect`, provider `google`, dynamic base URL, gate on `VERCEL_CONNECT_GOOGLE`, remove the OAuth proxy and `GOOGLE_*`, error message, checks updated | – | yes, with 3 |
| 2 | Indefinite sessions: 400 days, daily renewal; checks and the accounts docs updated | 1 | yes, with 3 |
| 3 | `scripts/reset-accounts.ts` with its host guard and check | – | yes, with 1 and 2 |
| 4 | Docs: `docs/DEPLOY.md` (Connect setup, switch order, no proxy), `docs/ARCHITECTURE.md`, README, `.env.example`; mark `custom-domain`'s Google step as superseded (`preview-deploys` was updated with this decision) | 1, 2, 3 | no |
| 5 | Switch and hand check (stakeholder with an agent): set up production client and connector, merge, reset Preview then Production, re-invite, hand check including the treated-as-proven items, try removing `prompt=consent`, record token-request counts, delete old variables and clients | 4 | no |

Tasks 1 and 2 both edit `src/lib/auth.ts`, so 2 waits for 1. Task 3 is a new
file and runs beside them.

## Dependencies

- `accounts`, merged and live in production.
- The stakeholder, for Google Cloud and Vercel setup and for running the
  reset (task 5).
- The spike's Google client and connector, reused for Preview.
- npm: `@vercel/connect`.
- Supersedes: `preview-deploys`' `auth-proxy` setup. Simplifies:
  `custom-domain` (no Google step).

## Success Criteria (Technical)

- `npm run typecheck`, `npm run lint`, `npm run smoke` and `npm run build`
  pass in CI with no Vercel, Connect or Google secrets.
- The checks prove, offline:
  - sign-in started on each allowed host goes to
    `https://connect.vercel.com/oauth/authorize` with `client_id` = the
    connector, PKCE, and `redirect_uri` = `https://<that host>/api/auth/callback/google`;
  - a request on a host outside the allowlist is refused;
  - production's allowlist never contains a preview host, and never a
    wildcard;
  - ID-token sign-in is refused;
  - the invite-only hook, the verified-email rule and
    `disableImplicitLinking` still hold for the `google` provider;
  - sessions last 400 days and renew at most daily;
  - production with no connector or no secret is `closed`; local with no
    connector is the dev owner;
  - the reset script refuses a mismatched `--confirm-host`.
- `grep -ri "oauth_proxy\|oAuthProxy\|GOOGLE_CLIENT_SECRET" src scripts docs .env.example`
  finds nothing.
- Hand check on production and on a PR preview, both its branch address and
  its per-deployment address: owner signs in; an invited member signs in and
  is a Member; an uninvited account is refused; a removed member is signed
  out on their next request.

## Estimated Effort

Five tasks. Task 1 is medium; 2 and 3 are small; 4 is small to medium; 5 is
mostly the stakeholder's setup plus a short hand check. Critical path:
1 → 2 → 4 → 5, with 3 beside 1 and 2.
