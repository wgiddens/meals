---
name: vercel-connect-auth
description: Move Google sign-in, in production and on every preview, to Vercel Connect's Better Auth adapter, retiring the OAuth proxy and our own Google redirect URIs
status: backlog
created: 2026-11-11T03:07:09Z
updated: 2026-11-11T16:40:00Z
---

# PRD: vercel-connect-auth

> **Decided: go (stakeholder, 2026-11-11).** The investigation this PRD
> began as is done; the result is in [Decision](#decision) and the answers
> under [Open Questions](#open-questions). The spike lives on the branch
> `claude/spike-vercel-connect` and is never merged. The implementation is the
> `vercel-connect-auth` epic (`.claude/epics/vercel-connect-auth/epic.md`).

## Executive Summary

Members sign in with Google through Better Auth. Today each environment
talks to Google with its own OAuth client, and previews reach Google only
through Better Auth's `oAuthProxy` and a fixed proxy branch (`auth-proxy`,
not yet set up). Vercel Connect's Better Auth adapter sends sign-in through a
Vercel-managed OAuth gateway: Google only ever redirects to
`https://connect.vercel.com/callback`, and the gateway hands the sign-in back
to whichever deployment started it. A spike showed that working on a Vercel
preview with no proxy. This PRD moves Google sign-in to Connect everywhere,
removes the OAuth proxy, and lets sessions last indefinitely.

## Problem Statement

- **Previews can't sign in.** Google only returns to registered addresses,
  and every preview has a new one. The fix in place, `oAuthProxy` plus a
  long-lived `auth-proxy` branch, is a lot of moving parts: three
  `OAUTH_PROXY_*` variables, a branch to fast-forward after every merge,
  hand-written guards against the plugin's open-redirect and hand-back risks
  (`src/lib/auth.ts`), and a residual risk accepted on #24. `auth-proxy` was
  never created, so preview sign-in is broken today.
- **Every address change re-registers Google.** `custom-domain` has to add a
  new callback URL to the production Google client.
- **A client secret per environment** is stored in Vercel and has to be
  rotated by hand.
- **Sessions expire after 90 days**, which signs the family out for no good
  reason. Google itself keeps people signed in until they sign out.

## Decision

**Go.** Decided by the stakeholder on 2026-11-11, after the spike.

What decided it:

- **Previews sign in with no proxy.** On the spike's branch preview
  (`meals-git-claude-spike-vercel-…vercel.app`), "Continue with Google" went
  to `connect.vercel.com`, on to Google, and back to the preview's own
  `/api/auth/callback/<providerId>`, where the app's own rules ran. Nothing
  fixed sat in between. Each deployment uses its own addresses as Better
  Auth's base URL (`baseURL: { allowedHosts: [VERCEL_URL, VERCEL_BRANCH_URL] }`),
  so `BETTER_AUTH_URL` is not needed on previews.
- **What it removes:** `oAuthProxy` and our guards around it, the
  `auth-proxy` branch and its upkeep, `OAUTH_PROXY_URL`,
  `OAUTH_PROXY_SECRET`, `OAUTH_PROXY_PREVIEW_PATTERN`, the accepted residual
  risk from #24, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel (the
  secret lives in the connector), and the per-address Google redirect URIs
  (Google has exactly one: `https://connect.vercel.com/callback`).
- **What it keeps:** Better Auth, our database and sessions, the
  invite-only hook, `disableImplicitLinking`, the dev owner and checks that
  run without any Vercel login or token.

Accepted costs and risks:

- **Google stays "Custom OAuth" in substance.** Connect lists Google as a
  known service, but we still register the Google OAuth client and give
  Connect its id and secret. The benefit is the gateway, not freedom from
  Google Cloud.
- **A consent screen on every sign-in, and stored refresh tokens.** The
  Google connector asks Google for `access_type=offline` and `prompt=consent`
  (read from the connector's configuration through the Vercel API), so
  Google shows its consent screen on each sign-in, and Connect keeps a
  refresh token for each member (`hasStoredTokens: true`). Accepted: with
  indefinite sessions (below) a sign-in is rare. The epic tries to remove
  both from the connector and records whether Connect allows it.
- **Existing members sign in once more.** The provider changes, and
  `disableImplicitLinking` refuses an existing member whose Google link is
  under the old provider (the spike's first sign-in was refused with
  `account_not_linked` for exactly this reason). The stakeholder chose to
  re-invite everyone rather than migrate rows.
- **Vendor dependency.** Sign-in now depends on `connect.vercel.com` as well
  as Google. Connect has been generally available since August 2026.

Treated as proven by the stakeholder's decision, and checked by hand on
the epic PR's own preview before it merges (epic task 5; not yet seen on a
real deployment):

- Google's `email_verified` arrives as `true` through Connect's userinfo.
  If it doesn't, the invite-only hook refuses every new sign-up with
  `EMAIL_NOT_VERIFIED`, which fails closed rather than open.
- An invited account becomes a member; an uninvited one is refused.
- Sign-in works on a per-deployment preview address as well as the branch
  address.
- A sign-in counts as at most one billed token request, if any.
- Connect's `sub` is stable for a Google account, and whether it is
  Google's own `sub`. The spike logged whether it matched an existing
  Google row, but no sign-in ran while the logs were captured, so this is
  unknown. It decides whether a connector can be replaced without another
  reset, and what a rollback restores (epic, "Rollback").

### What it means for `preview-deploys`

- `auth-proxy` is not needed and should not be created. The `OAUTH_PROXY_*`
  variables and Preview's `BETTER_AUTH_URL` are deleted once this epic
  lands.
- `preview-deploys`' acceptance criterion about the fixed proxy branch is
  replaced: preview sign-in works on every preview through Connect. Its open
  question 6 (`auth-proxy` and `custom-domain`) goes away.
- Previews still need their own database and their own `BETTER_AUTH_SECRET`,
  and Deployment Protection stays on. Each preview's sign-in creates
  sessions in that preview's database, as today.

### What it means for `custom-domain`

The domain move no longer touches Google. Production's base URL gains the
new host; Google's only redirect URI stays `connect.vercel.com/callback`.
Sessions are still tied to the address, so everyone signs in once more after
the move. The stakeholder put this PRD before `custom-domain` on
2026-11-11, so `custom-domain` never needs a Google step.

## What we know

From Vercel's docs (read 2026-11-11, live, unless marked otherwise):

- **The adapter:** `@vercel/connect/betterauth` (`@vercel/connect` 2.9.1),
  `connect({ providerId, connector, scopes? })`, returns a `genericOAuth`
  config. The browser goes to `https://connect.vercel.com/oauth/authorize`;
  the code exchange (`/oauth/token`) and userinfo (`/oauth/userinfo`) also go
  through `connect.vercel.com`. PKCE is on; the scopes are
  `openid profile email` plus `offline_access`, which the adapter always adds.
  ([Better Auth with Vercel Connect](https://vercel.com/docs/connect/frameworks/better-auth);
  package source.)
- **No client secret in the app:** the code exchange is authenticated with
  the deployment's Vercel OIDC token, which Vercel provides and rotates.
  Locally, `vercel env pull` writes one that lasts about 12 hours.
  ([Better Auth](https://vercel.com/docs/connect/frameworks/better-auth),
  [Authentication](https://vercel.com/docs/connect/concepts/authentication))
- **Better Auth 1.7 differs from Vercel's docs.** Vercel's page shows
  `authClient.signIn.oauth2` and a callback at `/api/auth/oauth2/callback/<id>`.
  In the installed Better Auth (1.7.20), `genericOAuth` registers its providers
  as ordinary social providers: sign-in is `authClient.signIn.social({ provider })`
  and the callback is `/api/auth/callback/<providerId>`. The spike uses the
  1.7 form, and it worked.
- **Project links:** a connector is linked to a project per environment
  (Production, Preview, Development, Custom Environments). An environment that
  isn't linked gets a 403, `Connector is not enabled for this environment`.
  The docs snippet "Preview and Development deployments cannot…" is an
  example of exactly that, not a limitation of previews.
  ([Project links](https://vercel.com/docs/connect/concepts/project-links),
  [Authentication](https://vercel.com/docs/connect/concepts/authentication))
- **Google:** Connect knows Google as a service whose OAuth method takes our
  own client ("bring your own credentials"). Its only redirect URI is
  `https://connect.vercel.com/callback`. The created connector uses Google's
  `accounts.google.com/o/oauth2/v2/auth` and `oauth2.googleapis.com/token`
  endpoints with `client_secret_post`, and adds `access_type=offline` and
  `prompt=consent` to the authorization request. (Spike connector, read
  through the Vercel API.)
- **Cost:** Hobby includes 500 token requests a month. A token request is
  "a single call to the Vercel Connect API that returns a provider token, for
  example a `getToken` call"; the pricing page doesn't say whether a sign-in
  counts. Even if every sign-in counts once, a family of four with
  indefinite sessions uses a handful a month.
  ([Pricing](https://vercel.com/docs/connect/pricing))
- **Rate limits:** the OAuth gateway allows 6,000 requests a minute per
  connector. ([Limits](https://vercel.com/docs/connect/limits))
- **Not covered by the docs:** how the gateway validates the app's
  `redirect_uri` (the spike shows a preview's own address is accepted), and
  whether `sub` and `email_verified` are Google's own values passed through.

## The spike

Branch `claude/spike-vercel-connect` (never merged), commits `efb960f` and
`57fc2d4`:

- Behind `VERCEL_CONNECT_GOOGLE` on Preview only, Google sign-in went
  through `connect()` as provider `google-connect`, with
  `baseURL: { allowedHosts: [VERCEL_URL, VERCEL_BRANCH_URL] }` and the proxy
  plugins off. Production ignored the variable.
- An offline check (`scripts/spike-connect.ts`) showed that sign-in started
  on either of a preview's two addresses goes to `connect.vercel.com` with a
  callback on that same address, that any other address is refused, and that
  ID-token sign-in is refused for the Connect provider.
- Setup, done by the stakeholder: a new Google OAuth client
  `meals-connect-spike` (redirect URI `https://connect.vercel.com/callback`)
  in the existing Google Cloud project, a connector
  `google/meals-google-spike` linked to the meals project for Preview only,
  OIDC federation on (Team issuer), and `VERCEL_CONNECT_GOOGLE` on Preview
  for the spike branch only.
- Result on the branch preview: the full round trip through Connect and
  Google worked; the app refused the sign-in with `account_not_linked`,
  because the stakeholder's existing member row is linked under provider
  `google`. That refusal is `disableImplicitLinking` working as designed.
- Not observed: the `[connect-spike] userinfo` log lines (claim names,
  `email_verified`, whether `sub` is Google's numeric id and matches the
  existing row). The API only streams live logs, and no sign-in ran while
  they were captured.

## User Stories

### 1. Previews sign in like production
As the developer, I sign in with Google on any preview, branch address or
per-deployment address, with no proxy branch to keep up.

Acceptance criteria:
- "Continue with Google" works on a PR preview's branch address and on its
  per-deployment address, landing back on the address it started from.
- No `auth-proxy` branch, no `OAUTH_PROXY_*` variable and no `oAuthProxy`
  code exist.
- Preview has no `BETTER_AUTH_URL`.

### 2. The family signs in once and stays signed in
As a family member, after one sign-in on a device I stay signed in until I
sign out or the owner removes me.

Acceptance criteria:
- A session that is used keeps renewing and does not expire while the
  device keeps using it (browsers cap a cookie at 400 days, so the session
  lasts 400 days from its last renewal).
- Removing a member still signs them out on their next request.

### 3. Everyone moves over once
As the owner, I switch production to Connect and the family signs back in
once, with the same rules as before.

Acceptance criteria:
- After the switch, the owner signs in with Google through Connect and is
  the family's owner again. The family's name and all meals data are
  unchanged.
- The owner re-invites each member from `/family`; each signs in with
  Google and becomes a member.
- An uninvited Google account is refused.
- An email that Google hasn't verified can't sign up.

### 4. Local development is unchanged
As the developer, `npm run dev` on a fresh clone still opens the app as the
dev owner with no setup, and CI needs no Vercel token.

Acceptance criteria:
- With no connector configured locally, the dev owner applies, as today.
- Optional: with `vercel env pull` (Development linked), real sign-in
  through Connect works on `localhost`.
- `npm run smoke` passes in CI with no Vercel or Google secrets.

## Functional Requirements

- **Provider:** Google sign-in goes through `@vercel/connect/betterauth`'s
  `connect()` inside Better Auth's `genericOAuth` plugin, in every
  environment. Better Auth's built-in `google` social provider and
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are removed.
- **Provider id:** `google`. Every existing account row is removed by the
  reset below, so nothing collides.
- **Connector per environment:** Production has its own Google OAuth client
  and connector, linked to Production only. Preview and Development share a
  second client and connector. Production and previews stay fully separate,
  as decided on #24. The app reads the connector's UID from
  `VERCEL_CONNECT_GOOGLE`.
- **Base URL:** Better Auth's base URL comes from the request's host,
  restricted to an allowlist built from the environment only:
  - production: the hosts of `BETTER_AUTH_URL` and Vercel's
    `VERCEL_PROJECT_PRODUCTION_URL` (which becomes `meals.giddens.app` when
    `custom-domain` adds it);
  - preview: the deployment's own `VERCEL_URL` and `VERCEL_BRANCH_URL`;
  - local: `localhost` and `127.0.0.1` on any port.
  Never a preview host in production, never a wildcard such as
  `*.vercel.app`, no fallback, and `https` only on Vercel.
- **Trusted origins:** as today, without the proxy's origin.
- **Rules kept:** the invite-only before-create hook, the verified-email
  requirement, `disableImplicitLinking`, server-only `role`, the
  after-create hook, cookie cache off, ID-token sign-in impossible.
- **Sessions:** 400 days, renewed at most once a day while in use. This
  replaces accounts' 90-day lifetime.
- **Gate:** "sign-in configured" means a connector UID, `BETTER_AUTH_SECRET`
  and at least one allowed host. Production fails closed without any of
  them. The dev owner still applies outside production when no connector
  is set.
- **Stored tokens:** the adapter always requests `offline_access`, so
  Better Auth stores Connect tokens in `account`; they are encrypted at rest
  (`account.encryptOAuthTokens`).
- **Reset:** a one-off, owner-run step deletes every user row, and so every
  session, Google link and invitation, in one database. Meals data and the
  family row stay. The owner's first sign-in through Connect makes them
  owner again through the existing `OWNER_EMAIL` bootstrap, so `OWNER_EMAIL`
  must be set on that environment, in the live deployment, before the
  reset. It refuses to run without an explicit confirmation naming the
  database host, and a Neon snapshot of the database is taken first.
- **Order and rollback:** Preview is reset and hand-checked on the epic
  PR's preview before the epic merges; Production switches after the
  merge, from a runbook in `docs/DEPLOY.md` with a snapshot and a rollback
  path (the epic's "Rollback").
- **Errors:** `ConnectError`s are logged with code and status only, never
  the vendor payload. The sign-in page explains `oauth_code_verification_failed`
  with a generic message.
- **Removed:** `oAuthProxy` and its guards, `OAUTH_PROXY_*`, the proxy's
  checks in `scripts/check-auth.ts`, and the `auth-proxy` instructions in
  `docs/DEPLOY.md`.

## Non-Functional Requirements

- **Cost:** within Hobby's free allowance: 500 Connect token requests a
  month, against a handful of sign-ins.
- **Local development:** no setup; no Vercel login needed for the dev
  owner. CI green with no Vercel token.
- **Security:** no weaker than today. No secrets in the repository; Google's
  client secret lives only in the connector. Production's connector and
  Google client are separate from Preview's.

## Success Criteria

- On production, the hand check passes: owner signs in, invites a member,
  the member signs in, an uninvited account is refused, a removed member is
  signed out on their next request.
- On a PR preview, sign-in works on the branch address and on the
  per-deployment address.
- `grep -ri "oauth_proxy\|oAuthProxy" src scripts docs` finds nothing.
- The connector's Observability tab shows how many token requests a month
  sign-in uses; recorded in `docs/DEPLOY.md`.

## Constraints & Assumptions

- **Stack is fixed** as in `accounts`: Next.js 16, Better Auth 1.7,
  Postgres (PGlite locally, Neon in production). Follow `AGENTS.md`.
- **Hosting stays on Vercel Hobby.**
- **The project uses OIDC federation** (Team issuer), which Connect needs.
- **Connect is new.** Re-read its docs when the epic starts.

## Out of Scope

- Connect's `getToken` for calling Google or other APIs.
- Auth.js, or replacing Better Auth.
- Passkeys (`passkeys`) and email sign-in (`email-sign-in`). They are
  separate sign-in methods; this PRD changes only Google.
- Migrating existing account rows: the stakeholder chose re-invite.

## Dependencies

- `accounts`, built and live.
- The stakeholder for manual setup: two Google OAuth clients (or the spike's
  one reused for Preview), two connectors, project links, and Vercel
  variables.
- Order: right after `accounts`, before `custom-domain` (stakeholder,
  2026-11-11).
- Related: `preview-deploys` (drops `auth-proxy`), `custom-domain` (no
  Google re-registration), `passkeys` (unaffected).
- `docs/PRODUCT.md`: it wins on conflict.

## Open Questions

Answered 2026-11-11.

1. **Can Connect sign in with Google?** Yes. Google is a known Connect
   service, but its OAuth method takes our own client: we register the
   Google OAuth client and give Connect the id and secret, the same work as
   "Custom OAuth". It worked on a preview in the spike.
2. **What's left of the benefit?** The gateway: one redirect URI for every
   address, so previews sign in with no proxy and the domain move doesn't
   touch Google, and no Google secret in the app's environment. That's
   enough to go ahead.
3. **Does it work with passkeys, the invite-only hook and one member per
   person?** The invite-only hook and `disableImplicitLinking` run unchanged:
   Connect hands Better Auth an ordinary OAuth profile, and the spike's
   refusal (`account_not_linked`) came from our own rule. Passkeys aren't
   built yet; they are a Better Auth plugin, independent of the Google
   provider, so nothing here blocks them.
4. **Is a sign-in a billed token request?** The docs don't say. Even at one
   per sign-in, the family's use is a few a month, well inside Hobby's 500.
   The epic reads the real count from the connector's Observability tab.
5. **Custom domain and previews?** Previews: yes, on their own addresses,
   with no fixed proxy (spike). Custom domain: the domain becomes an allowed
   host for the base URL; Google isn't touched.
6. **Local development?** The dev owner still needs nothing. Real sign-in
   locally is optional and needs `vercel env pull`, whose token lasts about
   12 hours. That's acceptable for occasional use. CI needs no token.
7. **Does the email arrive reliably enough to match an invitation?** The
   adapter passes `email` and maps `email_verified` (defaulting to `false`).
   The stakeholder treats it as proven; the epic's hand check confirms it.
   If Connect ever drops `email_verified`, sign-up fails closed with
   `EMAIL_NOT_VERIFIED`.
