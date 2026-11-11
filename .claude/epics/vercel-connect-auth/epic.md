---
name: vercel-connect-auth
status: backlog
created: 2026-11-11T16:04:34Z
updated: 2026-11-11T18:05:00Z
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

The epic ends when its PR has passed the full hand check on its own preview.
Production is switched from a runbook in `docs/DEPLOY.md`, not as an epic
task. Its setup steps (connector, variable, `OWNER_EMAIL`, snapshot) are a
precondition of the epic merge, because merging deploys production at once.
The reset and re-invite come after the merge.

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
`/oauth2/...` paths Vercel's docs show for older Better Auth). The checks
assert that no built-in `google` social provider is configured, so the
generic one is the only `google`.

- Rejected: keeping both providers. Two sign-in paths to secure and test.
- Rejected: migrating account rows to the new provider. The stakeholder
  chose a reset and re-invite. The reset also removes every old `google`
  row, so the reused id can't match a stale link.

### Base URL from the request, limited to this deployment's own addresses
`baseURL: { allowedHosts, protocol }` (Better Auth's dynamic base URL). One
pure function, `authAllowedHosts(env)` in `src/lib/gate.ts`, builds the list
from the environment only, never from the request:

| Environment | Allowed hosts |
| --- | --- |
| Production (`VERCEL_ENV=production`) | the hosts of `BETTER_AUTH_URL` and `VERCEL_PROJECT_PRODUCTION_URL`, but none unless `BETTER_AUTH_URL` is a valid URL |
| Preview | `VERCEL_URL` and `VERCEL_BRANCH_URL` |
| Not production (`NODE_ENV`) | also `localhost:*` and `127.0.0.1:*` |

Rules:
- In production the list is empty unless `BETTER_AUTH_URL` is a valid URL;
  `VERCEL_PROJECT_PRODUCTION_URL` only adds to it. Vercel always sets
  `VERCEL_PROJECT_PRODUCTION_URL`, so without this rule production would
  never fail closed on a missing `BETTER_AUTH_URL` (stakeholder,
  2026-11-11, during decomposition).
- No preview host in production and no wildcard ever, such as `*.vercel.app`.
  A request on any other host fails.
- `VERCEL_PROJECT_PRODUCTION_URL` is Vercel's production domain. It becomes
  `meals.giddens.app` when `custom-domain` adds it. So the new domain is
  allowed as soon as it is live, and the old address stops being allowed
  once `custom-domain` changes `BETTER_AUTH_URL`.
- `protocol` is `"https"` when `VERCEL_ENV` is `production` or `preview`,
  so trusted origins never gain `http://` versions of the deployed hosts.
  Otherwise it is `"auto"`: an explicit `"https"` would also apply to
  loopback hosts and break Connect sign-in on `localhost`. That matters
  because `vercel env pull` writes `VERCEL_ENV="development"`; confirm this
  in task 1. The gate-table checks include `VERCEL_ENV=development`.
- `advanced.trustedProxyHeaders` stays off.
- `baseURL.fallback` is never set.
- `trustedOrigins()` keeps today's rules minus the proxy origin.

This is what lets Connect return to the address sign-in started on, with no
fixed proxy.

### The gate is closed whenever Better Auth couldn't start
Better Auth throws at start-up when `allowedHosts` is empty. So in
production `gateMode()` is `closed` unless all three hold:
- `VERCEL_CONNECT_GOOGLE` is set;
- `BETTER_AUTH_SECRET` is set;
- `authAllowedHosts(env)` is non-empty.

The last condition covers production with `BETTER_AUTH_URL` unset or
invalid, and a `NODE_ENV=production` run outside Vercel. Outside production
with no connector, everyone is the dev owner, so `npm run dev` and CI need
nothing.

### The OAuth proxy is removed entirely
These all go:
- `oAuthProxy`, `oauthProxyRole()`, `oauthProxyOrigin()`,
  `oauthProxySecret()`, `previewOriginPattern()` and
  `proxyDestinationAllowed()`;
- the three guard plugins;
- the proxy's flow checks in `scripts/check-auth.ts`.

One assertion stays, in every environment's configuration:
`/api/auth/callback/google/oauth-proxy` and `/api/auth/oauth-proxy-callback`
answer 404.

### Sessions last 400 days and renew daily
`expiresIn` 400 days (the most a browser keeps a cookie), `updateAge` one
day. A device that keeps using the app never signs out. The cookie cache
stays off, so removing a member still signs them out on their next request.
This replaces accounts' 90-day lifetime (stakeholder, 2026-11-11).

### OAuth tokens are encrypted at rest
The adapter always asks for `offline_access`, so Better Auth stores a Connect
refresh token in each `account` row. `account.encryptOAuthTokens: true`
encrypts them with `BETTER_AUTH_SECRET`. The app never uses these tokens.

### One-off reset, run by the owner, after a backup
`scripts/reset-accounts.ts` deletes every row of `user` in the database
`DATABASE_URL` points at. Sessions, account links and invitations cascade.
The `family` row and all meals data stay.

The owner's first sign-in through Connect recreates them as owner through
the existing `OWNER_EMAIL` bootstrap. The family insert is
`onConflictDoNothing`, so the family keeps its name. The owner then
re-invites members from `/family`.

Safety:
- It refuses to run unless `--confirm-host=<host>` equals the host of
  `DATABASE_URL`.
- It prints only that host, the database name and the row counts, never the
  URL.
- Before deleting, it prints a reminder: `OWNER_EMAIL` must be the owner's
  Google email on this environment, in the deployment that is live, or
  nobody can become owner afterwards.
- It asks for nothing interactively.
- It is run by the stakeholder, never by an agent, and only after a Neon
  snapshot of that database (see Rollback).

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
- `src/lib/auth.ts`: the Connect provider, the dynamic base URL from
  `authAllowedHosts()`, proxy removed, 400-day sessions,
  `encryptOAuthTokens`, `ConnectError` logging. `googleConfig()` becomes a
  connector check.
- `src/lib/gate.ts`: `authAllowedHosts(env)`; `gateMode()` keys on the
  connector, the secret and a non-empty allowlist.
- `scripts/check-auth.ts`, `scripts/check-accounts.ts`, `scripts/smoke.ts`:
  - drop the proxy flow checks;
  - keep the 404 assertion for the hand-back paths;
  - update the gate table for the new variable and the empty-allowlist
    cases.

  The new checks then run **full sign-ins offline**, as `check-auth.ts`
  already does for Google today:
  - `connect({ getVercelOidcToken })` is given a fixed fake token;
  - `fetch` is stubbed for `connect.vercel.com/oauth/token` and
    `/oauth/userinfo`;
  - no network is used.
- `scripts/reset-accounts.ts`: new, not part of `npm run smoke`, with a
  small check that its host guard refuses a mismatch.

### Infrastructure
- **Package:** `@vercel/connect`, pinned to an exact version: 2.9.1, or the
  latest when the epic starts. Re-read its `betterauth` source first.
- **Google Cloud:** a production OAuth client whose only redirect URI is
  `https://connect.vercel.com/callback`. The spike's `meals-connect-spike`
  client is reused for Preview and Development. The old clients are
  deleted at the end of the production runbook.
- **Vercel Connect:**
  - a production connector, linked to Production only;
  - the spike's `google/meals-google-spike` connector, linked to Preview and
    Development.

  Don't replace a connector once members have signed in through it, unless
  the hand check shows `sub` is Google's own (see task 5). A replaced
  connector otherwise means another reset.
- **Vercel variables:**
  - `VERCEL_CONNECT_GOOGLE` on each environment.
  - Delete `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_PROXY_URL`,
    `OAUTH_PROXY_SECRET`, `OAUTH_PROXY_PREVIEW_PATTERN`, Preview's
    `BETTER_AUTH_URL` (deleted earlier, in task 5's setup), and the spike
    branch's override.
  - Production keeps `BETTER_AUTH_URL` (its allowed host),
    `BETTER_AUTH_SECRET` and `OWNER_EMAIL`.
- **OIDC federation:** on (Team issuer). Already done in the spike.
- **CI:** no new secrets.

## Implementation Strategy

1. **Swap the provider and remove the proxy in one step**, so the app is
   never on two Google paths at once. Every check passes offline.
2. **Sessions and the reset script** are small. The reset script is a new
   file and runs beside step 1. Sessions touch `auth.ts`, so they wait for
   it.
3. **Docs before the hand check.** The preview steps and the production
   runbook exist before anyone runs them.
4. **Preview first, then merge** (task 5):
   1. Snapshot the Preview database.
   2. Set Preview's `VERCEL_CONNECT_GOOGLE`, check Preview's
      `OWNER_EMAIL`, and delete Preview's `BETTER_AUTH_URL` (the never-created
      fixed preview's address, which `/family` would otherwise show after an
      invitation).
   3. Reset the Preview database.
   4. Run the full hand check on the epic branch's preview (the deployment
      the epic PR shows), on its branch
      address and its per-deployment address.

   The epic merges only when that passes.
5. **Production: setup before the merge, reset after it.** This is the
   runbook in `docs/DEPLOY.md`. Steps 1–5 are epic task 6, so the epic PR
   can't open until they are done; steps 6–9 are not an epic task. Merging to `main` deploys
   production at once. Without a connector, the gate is `closed` and the
   family, existing sessions included, is locked out. So steps 1–5 are a
   precondition of the epic merge.
   1. Create the production Google client and connector.
   2. Set Production's `VERCEL_CONNECT_GOOGLE`. Old code ignores it.
   3. Confirm `OWNER_EMAIL` is set on Production and that the live
      deployment was built after it was set.
   4. Check that project links are isolated: a code exchange from the epic
      branch's preview against the production connector gets a 403.
   5. Take a Neon snapshot of the production database.
   6. Merge the epic; production deploys.
   7. Run the reset on Production.
   8. The owner signs in, re-invites everyone, and runs the production
      hand check.
   9. Delete the old variables and Google clients.
6. **Follow `AGENTS.md`:** read the bundled Next.js docs before touching
   pages. Read the installed `better-auth` and `@vercel/connect` sources for
   APIs, not memory.

### Rollback

Each database gets a Neon snapshot (or restore point) taken just before its
reset.

- **Before the old variables are deleted** (runbook step 9):
  1. Roll back with Vercel's Instant Rollback to the last pre-epic
     deployment.
  2. Bring back the old sign-in rows. The old build looks up account rows
     by (`google`, Google's `sub`). Rows written through Connect only work
     for it if Connect's `sub` is Google's own.
     - Restoring the whole snapshot also loses every meal, plan and grocery
       change made since it was taken, so don't do that by default.
     - Instead, create a Neon branch from the snapshot and copy back only
       `user`, `session`, `account`, `invitations` and `verification`.
     - If task 5 showed `sub` is Google's own, resetting again (and
       re-inviting) also works, with no restore at all.
- **After step 9:** recreate `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
  for that environment first (the old build is otherwise `closed`), then
  roll back as above.

The spike tried to log whether Connect's `sub` matched an existing Google
row, but no sign-in ran while its logs were captured. The answer is unknown;
task 5 checks it.

### Risks

- **Treated as proven, not yet seen** (stakeholder's call), all checked in
  task 5 before the merge:
  - `email_verified` arrives as true through Connect;
  - invited and uninvited accounts get the right outcome;
  - sign-in works on the per-deployment preview address;
  - billing per sign-in.

  If `email_verified` arrives false, sign-up fails closed with
  `EMAIL_NOT_VERIFIED`, and the epic stops for a decision before merging.
- **Connect sends `prompt=consent` and stores refresh tokens.** Accepted.
  Task 5 tries to remove both in the connector and records the outcome.
  Better Auth's copies are encrypted.
- **Base URL resolution depends on the `host` header.** Vercel sets it.
  The allowlist is what keeps a forged host from being used, and the offline
  checks cover it.

## Task Breakdown Preview

| # | Task | Depends on | Parallel |
|---|---|---|---|
| 1 | Google sign-in through Connect: `@vercel/connect`, provider `google`, `authAllowedHosts()` and the base URL, gate on connector + secret + allowlist, `encryptOAuthTokens`, remove the OAuth proxy and `GOOGLE_*`, error message, offline full-sign-in checks | – | yes, with 3 |
| 2 | Indefinite sessions: 400 days, daily renewal; checks updated | 1 | yes, with 3 |
| 3 | `scripts/reset-accounts.ts`: host guard, `OWNER_EMAIL` reminder, its check | – | yes, with 1 and 2 |
| 4 | Docs: `docs/DEPLOY.md` (Connect setup, preview steps, the production runbook with backup and rollback, no proxy, connector-replacement warning), `docs/ARCHITECTURE.md`, README, `.env.example` | 1, 2, 3 | no |
| 5 | Preview reset and hand check on the epic branch's preview (stakeholder with an agent). Covers the treated-as-proven items, `sub` stability and gateway `redirect_uri` checking (below); project-link isolation is in the production runbook. Also tries removing `prompt=consent` and records the token-request count | 4 | no |
| 6 | Production pre-merge setup: runbook steps 1–5 (production client and connector, `VERCEL_CONNECT_GOOGLE`, `OWNER_EMAIL` live, project-link isolation, snapshot); stakeholder with an agent | 5 | no |

Tasks 1 and 2 both edit `src/lib/auth.ts`, so 2 waits for 1. Task 3 is a new
file and runs beside them.

### Task 5's hand check
Run on the epic branch's preview, on its branch address and on its
per-deployment address.

**The app's rules:**
- The owner signs in.
- An invited account signs in and becomes a Member.
- An uninvited account is refused.
- A removed member is signed out on their next request.

**Connect's behaviour:**
- **`sub` is stable:** the same Google account signing in twice reaches the
  same account row. A second sign-in after signing out must not be refused
  as `account_not_linked`.
- **`sub` source:** whether `sub` is Google's own (numeric) or a
  Connect-specific value. Recorded in the PRD; it decides whether a
  connector can ever be replaced without a reset.
- **The gateway checks `redirect_uri`:** an authorization request to
  `connect.vercel.com` with the Preview connector and a `redirect_uri` on a
  foreign host is refused.
- **Project links are isolated:** checked in the production runbook (step
  4), once the production connector exists and before the merge, not
  here.

**Recorded afterwards:** the `email_verified` value seen, whether
`prompt=consent` could be removed, and the connector's token-request count.

## Dependencies

- `accounts`, merged and live in production.
- The stakeholder, for Google Cloud and Vercel setup, Neon snapshots, and
  running the reset (task 5 and the production runbook).
- The spike's Google client and connector, reused for Preview.
- npm: `@vercel/connect`.
- Supersedes `preview-deploys`' `auth-proxy` setup. Comes before
  `custom-domain`, which then needs no Google step.

## Success Criteria (Technical)

- `npm run typecheck`, `npm run lint`, `npm run smoke` and `npm run build`
  pass in CI with no Vercel, Connect or Google secrets.
- The offline checks prove, with `fetch` stubbed for `connect.vercel.com`:
  - **The authorize step:** sign-in started on each allowed host goes to
    `https://connect.vercel.com/oauth/authorize` with
    `client_id` = the connector, PKCE, and
    `redirect_uri` = `https://<that host>/api/auth/callback/google`.
  - **The token request:** it carries `Authorization: Basic
    <connector>:<oidc>`, the `code_verifier`, and the same `redirect_uri`.
  - **Through the adapter's own profile mapping:**
    - `email_verified` false, missing or the string `"true"` gives
      `EMAIL_NOT_VERIFIED`;
    - an uninvited verified email gives `NOT_INVITED`;
    - an existing member's email with a different `sub` gives
      `account_not_linked`;
    - an invited verified email becomes a Member, with its stored tokens
      encrypted.
  - **Hosts:** a request on a host outside the allowlist is refused.
    Production's allowlist never contains a preview host or a wildcard, and
    is empty, so the gate is `closed`, when `BETTER_AUTH_URL` is unset or
    invalid, even with `VERCEL_PROJECT_PRODUCTION_URL` set.
  - **ID-token sign-in** is refused. No built-in `google` social provider
    is configured.
  - **Hand-back paths:** `/api/auth/callback/google/oauth-proxy` and
    `/api/auth/oauth-proxy-callback` answer 404.
  - **Sessions** last 400 days and renew at most daily.
  - **The gate:** production with no connector, no secret or no allowed host
    is `closed`. Local with no connector is the dev owner.
  - **The reset script** refuses a mismatched `--confirm-host`.
- `grep -ri "oauth_proxy\|oAuthProxy\|GOOGLE_CLIENT_SECRET" src scripts .env.example`
  finds nothing. `docs/DEPLOY.md` names the `GOOGLE_CLIENT_*` and
  `OAUTH_PROXY_*` variables only in the runbook's step-9 cleanup list and the
  rollback steps; no doc mentions `oAuthProxy` or `auth-proxy`. (This
  narrows the PRD's `grep ... docs` criterion, which would otherwise forbid
  the cleanup list.)
- Task 5's hand check passes on the epic branch's preview before the merge.
- The production runbook's steps 1–5 (task 6) (production client and connector,
  Production's `VERCEL_CONNECT_GOOGLE`, `OWNER_EMAIL` confirmed in the live
  deployment, project-link isolation, snapshot) are done before the merge.

## Estimated Effort

Six tasks:
- task 1 is medium (the offline full-sign-in checks are most of it);
- tasks 2 and 3 are small;
- task 4 is small to medium;
- task 5 is mostly the stakeholder's setup plus a short hand check;
- task 6 is the stakeholder's production setup plus one isolation check.

Critical path: 1 → 2 → 4 → 5 → 6, with 3 beside 1 and 2. The production
switch-over (runbook steps 6–9) follows the merge.

## Tasks Created
- [ ] 001.md - Google sign-in through Vercel Connect, OAuth proxy removed (parallel: true)
- [ ] 002.md - Sessions last 400 days and renew daily (parallel: true)
- [ ] 003.md - One-off account reset script (parallel: true)
- [ ] 004.md - Docs, Connect setup and the production runbook (parallel: false)
- [ ] 005.md - Preview reset and hand check on the epic's preview (parallel: false)
- [ ] 006.md - Production pre-merge setup (runbook steps 1–5) (parallel: false)

Total tasks: 6
Parallel tasks: 3
Sequential tasks: 3
Estimated total effort: 19 hours
