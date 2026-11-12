# Spike verdict: sign-in through Vercel Connect

Throwaway branch `prototype/vercel-connect-signin`, never merged. Code:
`7dc1318` (`src/lib/spike-connect.ts`, `/spike/connect`). Run on 2026-11-12
against connector `google/meals-google-spike`, locally (`next dev`, fresh
PGlite) and on preview deployment `meals-9ws61zkti` (branch URL
`meals-git-prototype-vercel-co-0426a2-…vercel.app`). Emails are redacted and
the Google subject is shortened to `1181…3499`. Every comparison below was made
on the full value.

## 1. Google ownership: we bring our own client

- Vercel dashboard, Connect, Add Connection, Google: the Configure step asks
  for a **Client ID (required)** and a Client Secret (optional), shows the
  fixed Redirect URI `https://connect.vercel.com/callback`, and is labelled
  "This is a Customer Owned Connector". There is no Vercel-managed option.
- The connector itself (`GET /v1/connect/connectors/scl_JFsGNMWqeFChIjmwEH9VQ`)
  shows `creationMode: "manual"`, `supportsManagedEjection: false`, our
  `clientId`, an encrypted secret, `refreshTokens.enabled`, and
  `authorizationUrlParams { access_type: offline, prompt: consent }`.
- The Google client is `meals-connect-spike` in Google Cloud project "Meals",
  the same project as the production and preview clients, so it shares their
  consent screen. Its only redirect URI is `https://connect.vercel.com/callback`.
- The consent screen is External, **Testing**, with 0 test users. It still let
  the project owner's account through. Whether other family accounts need to be
  test users (or the app published) is untested.
- Google's account chooser says "to continue to **vercel.com**", not Meals.

## 2. Previews: Connect returns to whatever `redirect_uri` we send, if it's on its allowlist

- Better Auth sends `redirect_uri = <baseURL>/api/auth/callback/<providerId>`
  to `connect.vercel.com/oauth/authorize`. Connect sends the browser to Google
  with its own `redirect_uri=https://connect.vercel.com/callback`, then back to
  ours. On the preview, the spike sent
  `https://meals-git-prototype-vercel-co-0426a2-…vercel.app/api/auth/callback/vercel-connect-google`
  and landed there. Locally it sent
  `http://localhost:3000/api/auth/callback/vercel-connect-google`.
- **Connect has a return-address allowlist that we never configured.** Probed
  with the same connector and `environment=preview`:

  | `redirect_uri` | Result |
  | --- | --- |
  | this preview's branch callback | accepted (real sign-in) |
  | another deployment of this project (`meals-git-epic-accounts-…`) | accepted |
  | `http://localhost:9999/anything` | accepted (any port and path, even for `environment=preview`) |
  | `https://meals-git-someone-else.vercel.app/…` | refused: "redirect_uri is not registered for this client" |
  | `https://example.com/…` | refused, same message |

  It looks like "this project's deployment hosts, plus localhost".
- The Preview `BETTER_AUTH_URL` (and `OAUTH_PROXY_URL`) is the fixed
  `epic/accounts` preview. With a static `baseURL` the `redirect_uri` would
  have pointed there, at a deployment without the Connect provider. The spike
  therefore resolves `baseURL` per request outside production:
  `{ allowedHosts: [VERCEL_URL, VERCEL_BRANCH_URL, "localhost:*", "127.0.0.1:*"], fallback: BETTER_AUTH_URL }`.
- **Better Auth's `oAuthProxy` hijacks Connect sign-ins.** Its hooks match
  every `/sign-in/social`, generic providers included, and send them to the
  proxy's fixed URL. The spike's button sends `x-skip-oauth-proxy` to get past
  it. The existing Google sign-in through the proxy kept working on the spike
  preview with the dynamic `baseURL`.
- On Vercel, `process.env.VERCEL_OIDC_TOKEN` is not set at runtime. The OIDC
  token comes from the request: preview tokens last 2 h, with sub
  `owner:…:project:meals:environment:preview`. The adapter still added
  `teamId`, `projectId` and `environment=preview` to the authorize URL.
  Locally the pulled token lasts about 12 h, for the `development` environment.

## 3. Subject: the adapter's `sub` is Google's own `sub`

| Where | Value |
| --- | --- |
| Connect userinfo `sub` (local and preview) | `1181…3499` |
| Connect access token `src` | `{ iss: "google", sub: "1181…3499" }` |
| Existing preview `account` row, `providerId: google` (socialProviders, 2026-11-11) | `accountId 1181…3499` |
| New local `account` row, `providerId: vercel-connect-google` | `accountId 1181…3499` |

Connect also has an ID of its own, the access token's `sub`
(`oauth_78c2…` locally, `oauth_2f41…` on the preview). It differs per
environment, so it isn't usable as identity, and the adapter doesn't use it.

## Other observations

- **Billing:** each sign-in's code exchange counts as one Connect token request,
  refused sign-ins included. Usage shows 3 of 500: 1 on Nov 11 and 2 on Nov 12,
  my local and preview sign-ins. The authorize probes don't count.
- **Profile:** `email_verified: true`, `name`, and `picture` (Google's lh3 URL).
  There's no `id_token`, `account.scope` is stored as an empty string, and the
  stored tokens are Connect tokens (`aud team_…:prj_…:<env>`, 12 h), not Google
  tokens.
- **Invite rule:** locally (fresh database, `OWNER_EMAIL` set) the Connect
  sign-up became the Owner. On the preview, the same Google account is already
  the Owner through `providerId: google`, so the Connect sign-in was refused
  with `account_not_linked` (implicit linking is off) and no Session was
  created.
- **Development environment variables** have `GOOGLE_CLIENT_SECRET` but no
  `GOOGLE_CLIENT_ID`, so locally `gateMode` is `dev-owner`. Attaching the
  connector adds no environment variable.

## What the real feature needs

- **Remove `oAuthProxy`** and its three guard plugins, `OAUTH_PROXY_*`, the
  fixed preview, and `OAUTH_PROXY_PREVIEW_PATTERN`. Connect's allowlist (this
  project's deployments plus localhost) replaces the proxy's origin checks.
  Keep `trustedOrigins`, still limited to `VERCEL_URL` and `VERCEL_BRANCH_URL`
  on previews and localhost outside production: it checks
  `callbackURL`/`errorCallbackURL`, which Connect doesn't.
- **`baseURL` per environment:**
  - Production: static `BETTER_AUTH_URL` = the production domain.
  - Preview: dynamic, with `allowedHosts` = this deployment's `VERCEL_URL` and
    `VERCEL_BRANCH_URL`. Don't set `BETTER_AUTH_URL` on Preview, or treat it
    only as a fallback; never the old fixed preview.
  - Local: unset, resolving to `localhost`.
- **Keep the existing account rows working.** Today's rows are
  `providerId: google` with `accountId` = Google `sub`, and Connect returns the
  same `sub`. Either register the Connect provider as `providerId: "google"`
  (replacing `socialProviders.google`), or migrate `provider_id`. Otherwise
  every existing Member hits `account_not_linked` once the switch happens.
  Untested here: a `genericOAuth` provider id that collides with a built-in
  social provider.
- **Re-key the gate:** `gateMode` and `googleConfig` decide on
  `GOOGLE_CLIENT_ID`/`_SECRET`, which go away. ADR 0002 already removes the
  dev-owner shortcut.
- **Budget:** one token request per sign-in, from 500 a month on Hobby.
  Sessions last 90 days, so this is small, but refused and repeated sign-ins
  count too.

## ADR 0001

**It holds; mark it accepted, with these changes:**

- Settle the "if Connect doesn't manage Google itself" clause. It doesn't: we
  own one Google client (`meals-connect-spike` today) in the Meals project,
  with only `https://connect.vercel.com/callback`.
- Add as consequences:
  - Previews need no registration because Connect allowlists the project's own
    deployments and localhost.
  - `baseURL` must come from the request on previews.
  - The OAuth proxy must be removed, not merely left unused, because it
    intercepts every social sign-in.
  - Each sign-in costs one Connect token request.
  - Google's chooser names vercel.com, not Meals.
- Note on the OIDC dependency: on Vercel the token comes from the request,
  2 h on Preview. Locally it's the ~12 h token from `vercel env pull`.
