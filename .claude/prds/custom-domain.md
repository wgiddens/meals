---
name: custom-domain
description: Serve the production app at meals.giddens.app on Vercel, with HTTPS, so the family, sign-in and assistants all use one stable address
status: backlog
created: 2026-11-11T02:54:14Z
---

# PRD: custom-domain

## Executive Summary

The production app moves from its generated `*.vercel.app` address to
**`https://meals.giddens.app`**. Vercel serves it with an automatic HTTPS
certificate. The app, the assistants' MCP endpoint, Google sign-in and passkeys all use
this one address from then on.

It is mostly setup: a DNS record, the Vercel project's domain settings, and
pointing the app's own configuration at the new address. The stakeholder
decided on 2026-11-11 to put `accounts` live on the generated `*.vercel.app`
address first. So this PRD also moves accounts' sign-in: `BETTER_AUTH_URL`
changes, and everyone signs in once more, because sessions are tied to the
address. Google itself is not touched: sign-in goes through Vercel Connect
(`vercel-connect-auth`, built before this PRD), whose only Google redirect
URI is `https://connect.vercel.com/callback`. It
should be done before `passkeys`, which are tied to the domain they were
created on.

## Problem Statement

- **The address is hard to remember and share.** The text that brings
  Shannon the weekly plan should carry a short link we recognise, not a
  generated Vercel address.
- **Sign-in needs an address that won't change.** Sessions are bound to
  the address, and `passkeys` will tie each passkey to the domain. Accounts
  launches on `*.vercel.app`, so this move signs everyone out once; doing it
  before `passkeys` avoids losing passkeys too.
- **Assistants are configured with a URL.** Each one we connect stores the
  MCP endpoint address; moving it later means reconfiguring every assistant.
- **Email needs a domain we own.** The `email` PRD cannot start until one is
  chosen. `giddens.app` is that domain.

## User Stories

### 1. The family opens the app at meals.giddens.app
As Shannon or Will, I open `meals.giddens.app` on my phone and get the app.

Acceptance criteria:
- `https://meals.giddens.app` serves the production deployment.
- `http://meals.giddens.app` redirects to `https://` with a permanent
  redirect.
- The browser shows a valid certificate with no warnings on iPhone Safari,
  Android Chrome and desktop Chrome.
- A push to `main` is live at `meals.giddens.app` with no extra step.

### 2. Assistants connect at the new address
As an assistant user, I give the assistant
`https://meals.giddens.app/api/mcp` and it works.

Acceptance criteria:
- The MCP endpoint answers at the new address with the same bearer token.
- Every assistant already connected is moved to the new address, and a
  "what's for supper?" request succeeds from each.

### 3. Sign-in uses the new address
As a family member, Google sign-in works at `meals.giddens.app`.

Acceptance criteria:
- The app's configured site address (`BETTER_AUTH_URL` once `accounts` is
  built) is `https://meals.giddens.app` in production.
- Sign-in with Google succeeds at the new address. The Google OAuth client
  is unchanged (its only redirect URI is Connect's). Production's allowed
  hosts come from `BETTER_AUTH_URL` and Vercel's
  `VERCEL_PROJECT_PRODUCTION_URL` (`vercel-connect-auth`), so the new
  domain is allowed as soon as it is the project's production domain, and
  the old `*.vercel.app` address stops being allowed once `BETTER_AUTH_URL`
  changes.
- `docs/DEPLOY.md` states that `<production-domain>` is
  `meals.giddens.app`, keeping its placeholder convention.

## Functional Requirements

- **DNS:** a record for `meals` on `giddens.app` points at Vercel (a CNAME
  to the target Vercel gives, unless the domain's nameservers are moved to
  Vercel, in which case Vercel creates it). The epic picks one approach.
  No other records on `giddens.app` change.
- **Vercel project:** `meals.giddens.app` is added to the project and
  assigned to production (`main`).
- **HTTPS:** Vercel issues and renews the certificate. `.app` is on the
  browser HSTS preload list, so the site only works over HTTPS; nothing
  should be set up assuming plain HTTP.
- **App configuration:** any place the code or docs build an absolute URL
  for production reads it from configuration and resolves to
  `https://meals.giddens.app`. No address is hard-coded.
- **Docs:** `docs/DEPLOY.md` states that `<production-domain>` is
  `meals.giddens.app`, and says where the DNS record lives.

## Non-Functional Requirements

- **Cost:** no new recurring cost beyond the yearly registration of
  `giddens.app`, which we already hold. Custom domains are free on Vercel's
  Hobby plan.
- **Downtime:** none for the app itself; the new address is added alongside
  the old one. Sign-in moves with `BETTER_AUTH_URL`, so after the switch
  members sign in at the new address. The old `*.vercel.app` address may
  keep serving pages, but signing in there no longer works.
- **Security:** HTTPS only; no secrets change; the MCP bearer token and
  accounts sign-in protect the app exactly as before.

## Success Criteria

- `https://meals.giddens.app` loads the app with a valid certificate on
  three browsers listed above.
- `curl -I` on `http://meals.giddens.app` returns a permanent redirect to
  `https://meals.giddens.app`.
- Every connected assistant answers "what's for supper?" through the new
  MCP URL.
- No code or doc refers to the production `*.vercel.app` address, checked
  by search.
- Google sign-in succeeds at the new address.

## Constraints & Assumptions

- **We own `giddens.app` and can edit its DNS.** Where it is registered and
  who serves its DNS is not recorded yet; the epic confirms it before
  anything changes.
- **Vercel Hobby plan** stays the host, as `docs/PRODUCT.md` asks.
- **DNS changes are manual steps for the repo owner** in the registrar's or
  Vercel's dashboard; the epic lists them exactly.
- **Order:** after `accounts` (stakeholder's decision, 2026-11-11, to go
  live on the Vercel address first), after `vercel-connect-auth`
  (stakeholder's decision, 2026-11-11), and before `passkeys`. Members sign
  in with Google once more after the move. The Google OAuth client is not
  touched.

## Out of Scope

- Email sending and the `giddens.app` mail records (SPF, DKIM): the `email`
  PRD.
- Anything on the bare `giddens.app` or other subdomains.
- Redirecting the old `*.vercel.app` address or keeping old links working.
  It may keep serving pages, but sign-in there stops working after the
  move; nothing depends on it.
- Custom addresses for preview deployments.
- Moving off Vercel or changing plan.

## Dependencies

- Ownership of `giddens.app` and access to its DNS.
- The existing Vercel project with production deploying from `main`.
- `accounts`, live in production.
- `vercel-connect-auth`, built first. Production's allowed hosts are the
  hosts of `BETTER_AUTH_URL` and `VERCEL_PROJECT_PRODUCTION_URL`; this PRD
  sets `BETTER_AUTH_URL` to `https://meals.giddens.app`. Google's only
  redirect URI stays `https://connect.vercel.com/callback`.
- `docs/PRODUCT.md` – it wins on conflict.
