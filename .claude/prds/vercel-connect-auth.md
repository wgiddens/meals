---
name: vercel-connect-auth
description: Later, investigate whether to move accounts' Google sign-in to Vercel Connect's Better Auth adapter instead of an OAuth client we manage ourselves
status: backlog
created: 2026-11-11T03:07:09Z
---

# PRD: vercel-connect-auth

> **Investigation, later.** Not urgent: `accounts` goes ahead with its own
> Google OAuth client and doesn't wait for this. Connect is new and Vercel is
> likely to add support, so pick this up once it has matured. The output is
> a written decision, plus a working spike if it looks promising. It has not
> been through a brainstorm. The open questions at the end are the starting
> point.

## Executive Summary

The `accounts` epic signs members in with Better Auth, using Google and
passkeys. As planned, we register our own Google OAuth client and keep its
client id and secret in Vercel. Vercel Connect has a Better Auth adapter that
sends sign-in through a Vercel-managed OAuth gateway, with no client secret
in the app. This PRD finds out whether that adapter now fits our sign-in,
and records whether to switch `accounts` over to it.

## Problem Statement

Running our own Google OAuth client means a Google Cloud project, a client
secret to store and rotate, and a callback URL to keep in step with the
production domain (`custom-domain`). Connect claims to take some of that
away. As of November 2026 it doesn't obviously cover Google, and we don't
know whether it works with passkeys and our invite-only rules, or what it
costs. It is brand new, so those answers are likely to change.

## What we know

From Vercel's docs (read 2026-11-10;
https://vercel.com/docs/connect/frameworks/better-auth):

- **What Connect is:** a team-level gateway. A connector is registered once
  per outside service and linked to projects. It does two jobs: sign-in,
  through the Better Auth and Auth.js adapters, and short-lived tokens for
  calling that service's API (`getToken`). Connect has been generally
  available since August 2026.
- **The Better Auth adapter:** `@vercel/connect/betterauth`, plugged into
  Better Auth's `genericOAuth` plugin. The browser calls
  `authClient.signIn.oauth2`. Better Auth serves the callback itself at
  `/api/auth/oauth2/callback/<providerId>`, based on `BETTER_AUTH_URL`.
- **No client secret:** the code exchange is authenticated with the
  project's Vercel OIDC token and PKCE. For managed connectors, Vercel
  registers the OAuth client.
- **Managed connectors listed:** Slack, GitHub, Linear, Microsoft,
  Snowflake, Salesforce. **Google is not listed.** Any other provider is a
  "Custom OAuth" connector, where we supply and manage the client ourselves.
  A sign-in connector must return a stable subject, email and name.
- **Configuration:** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `DATABASE_URL`, a connector id variable, and `VERCEL_OIDC_TOKEN`. The
  platform provides that token in deployments. Locally, `vercel env pull`
  writes it, and it expires after about 12 hours.
- **Environments:** a connector is linked per environment (Production,
  Preview, Development). An environment that isn't linked gets a 403.
- **Cost:** available on every plan. Hobby includes 500 token requests and
  1,000 triggers a month. It isn't stated whether a sign-in counts as a
  token request.
- **Not covered by the docs:** passkeys, email-link sign-in, custom domains,
  and how sign-in behaves on preview deployment URLs.

## User Stories

### 1. A decision on switching
As the developer, I know whether to move `accounts`' Google sign-in to
Connect.

Acceptance criteria:
- A short written decision (go, no-go, or not yet) answers every open
  question below, with links to sources.
- If go: a follow-up epic moves sign-in to Connect, listing environment
  variables, manual setup steps and what happens to existing members'
  linked Google accounts.
- If no-go or not yet: the reason is recorded in this PRD, with what would
  change the answer.

### 2. A spike proves it, if it looks promising
As the developer, I see a member sign in through Connect on a real
deployment before we commit to it.

Acceptance criteria:
- On a throwaway branch, a Connect-backed sign-in works locally and on one
  Vercel deployment, with Better Auth and our database.
- Passkey sign-in still works in the same build.
- The invite-only rule still holds: an email that isn't the owner, a member
  or an invitation is refused.
- The spike is not merged; what was learnt goes into the decision.

## Functional Requirements

To be written only if the decision is go, as changes to the `accounts`
epic. No production code is part of this PRD.

## Non-Functional Requirements

- **Cost:** must stay within the Hobby plan's free allowance for a family
  of four, including sign-ins.
- **Local development:** must still run with no setup. Signing in locally
  may need `vercel env pull`, but CI must stay green with no Vercel token.
- **Security:** no weaker than the planned `accounts` design: no secrets in
  the repository, and sessions and passkeys unchanged.

## Success Criteria

- The decision is recorded within one working session of starting.
- If go: existing members keep their accounts and passkeys after the
  switch.
- Every open question has an answer, or is marked unanswerable with the
  reason.
- If go: the spike shows sign-in working on a deployment, at
  `meals.giddens.app` if `custom-domain` is done.

## Constraints & Assumptions

- **Stack is fixed** as in `accounts`: Next.js 16, Better Auth, Postgres
  (PGlite locally, Neon in production). Follow `AGENTS.md` and read the
  bundled Next.js docs first.
- **Hosting stays on Vercel Hobby**, free or very cheap, as
  `docs/PRODUCT.md` asks.
- **Connect is new (generally available August 2026).** Re-read the docs
  when picking this up; the facts above may be out of date.
- **Google is what the family uses.** If Connect can't do Google without us
  managing the client anyway, most of its benefit is gone. That is the
  expected deciding factor.

## Out of Scope

- Building `accounts` itself, or delaying it.
- Using Connect's `getToken` to call third-party APIs (for example Walmart).
  It may matter later, but it's a separate question.
- Auth.js, or replacing Better Auth.
- Sign-in providers the family doesn't use (Slack, GitHub, Microsoft).

## Dependencies

- `accounts` built first: this decides whether to change its Google
  sign-in. `accounts` does not wait for it.
- A Vercel team where we can create a connector and run `vercel connect`.
- `custom-domain`: not required, but the callback depends on
  `BETTER_AUTH_URL`, so testing on the final address is better.
- `docs/PRODUCT.md`: it wins on conflict.

## Open Questions

1. Can Connect sign in with Google? Is it a managed connector, or only
   "Custom OAuth", where we register the Google client ourselves anyway?
2. If it's Custom OAuth, what's left of the benefit? Is it only that the
   secret lives in Connect instead of an environment variable?
3. Does the adapter work alongside Better Auth's passkey plugin and our
   invite-only hook, with one member record per person?
4. Does a sign-in count as a billed token request, and how many would a
   family of four use in a month?
5. How does sign-in behave on a custom domain and on preview deployment
   URLs? Can previews sign in at all?
6. Local development: is a 12-hour token from `vercel env pull` acceptable,
   and does the app still run with no Vercel login?
7. Does Connect reach a Google account's email reliably enough to match an
   invitation, which `accounts` requires?
