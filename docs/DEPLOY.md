# Deploying

The app runs on Vercel with its Neon Postgres integration. `main` is the
production branch; every pull request gets a preview. How sign-in works is in
[ARCHITECTURE.md](ARCHITECTURE.md#accounts-and-the-sign-in-gate); this page is
the one-time setup only the repo owner can do, and the hand check that proves
it on production.

Never commit real emails, client ids or secrets. Everything below uses
placeholders: `<production-domain>` is the production address,
`<fixed-preview-url>` the fixed preview's branch address (see step 3).

## Production and previews are fully separate

| | Production | Preview |
| --- | --- | --- |
| Who uses it | The family | The repo owner, for testing, signed in to Vercel |
| Database | Production's own | Its own, never production's |
| Google OAuth client | Production client | Preview client |
| `BETTER_AUTH_SECRET` | Its own | A different one |
| `OAUTH_PROXY_*` | Never set | Set |
| Deployment Protection | Off (public, gated by sign-in) | On |

Nothing is shared between the two. The proxy roles key on `VERCEL_ENV`: a
production hosted anywhere but Vercel has no `VERCEL_ENV`, so it must never
set `OAUTH_PROXY_*`.

## Setup checklist

Status: the stakeholder reported on 2026-11-11 that both Google OAuth clients
and the Vercel sign-in variables are in place, and that Google sign-in works
on the `epic/accounts` preview. The steps stay here for re-creating or
rotating them.

### 1. Databases

- [ ] **Production:** the Neon integration's database, `DATABASE_URL` on the
      Production environment.
- [ ] **Preview:** a separate database, set as `DATABASE_URL` on the
      Preview environment only. A preview build must never run migrations
      against production: every build runs them
      (`scripts/migrate-if-configured.mjs`), so a preview of an unmerged
      schema change would migrate the production database.
      - **Watch the Neon integration.** When it is connected, it can set the
        same `DATABASE_URL` for Preview as for Production. Connect it to
        Production only, or override Preview's `DATABASE_URL` with the
        separate database.
      - **Avoid per-preview Neon branches.** The integration can create a
        branch per preview, but each branch starts as a copy of production's
        rows: members, invitations, sessions and the Google tokens Better
        Auth stores with each linked account. Use a separate Preview
        database instead.
- [ ] **Check that Preview's `DATABASE_URL` differs from Production's.** In
      Vercel's environment variables, compare the two values' host and
      database name (the part after the last `/`). Look at those parts only;
      never paste or print the whole value, which contains the password. If
      host and database name are the same, stop and fix Preview before the
      next preview build.
- [ ] Never point a local dev server at the production database. With no
      Google client configured locally, everyone is the dev owner, and the
      dev owner reuses whoever already owns that database: anyone who can
      reach that dev server would act as the family's owner.

### 2. Google OAuth clients

In Google Cloud (APIs & Services → Credentials), create two OAuth clients of
type **Web application**. Sign-in asks only for the basic `openid`, `email`
and `profile` scopes. If the consent screen is in **Testing**, add every
family member's Google account as a test user, or publish it.

- [ ] **Production client.** Authorised redirect URI:
      `https://<production-domain>/api/auth/callback/google`
- [ ] **Preview client.** Authorised redirect URIs:
      - `<fixed-preview-url>/api/auth/callback/google` (today the
        `epic/accounts` branch preview; see step 3)
      - `http://localhost:3000/api/auth/callback/google`, for trying real
        Google sign-in locally with the preview client in `.env.local`. Use
        a throwaway local database for that, never a shared one.

### 3. The fixed preview (OAuth proxy)

Google only returns to registered addresses and each preview has a new one,
so every preview's Google sign-in goes through one fixed preview, which hands
it back.

- [ ] **Until the accounts epic merges:** the fixed preview is the
      `epic/accounts` branch preview. `<fixed-preview-url>` is its branch
      address exactly as Vercel reports it (`VERCEL_BRANCH_URL`), for
      example `https://meals-git-epic-accounts-<team>.vercel.app`.
- [ ] **After the epic merges into `main`, move the fixed preview to a
      long-lived `auth-proxy` branch,** in this order (deleting
      `epic/accounts` earlier breaks preview sign-in):
      1. Create `auth-proxy` from `main` and push it.
      2. Set `OAUTH_PROXY_URL` (Preview) to its branch address, exactly as
         Vercel reports it.
      3. In the preview Google client, swap the redirect URI to
         `<its branch address>/api/auth/callback/google`.
      4. Redeploy `auth-proxy` and sign in with Google on its preview.
      5. Redeploy one PR preview and sign in with Google there; it must go
         through `auth-proxy` and land back on the PR preview.
      6. Only then delete the `epic/accounts` branch.
- [ ] **Keep `auth-proxy` tracking `main`.** It runs the sign-in code for
      every preview, so after each merge to `main` fast-forward it:

      ```bash
      git fetch origin
      git push origin origin/main:refs/heads/auth-proxy
      ```

      Never commit to `auth-proxy` directly; if the push is refused as not a
      fast-forward, something was, and it should be reset to `main`.

### 4. Vercel environment variables

Set in Vercel → Project → Settings → Environment Variables. After changing
any, redeploy.

| Variable | Production | Preview |
| --- | --- | --- |
| `DATABASE_URL` | Production database (Neon integration) | The Preview database |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | A different `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://<production-domain>` | Leave unset: each preview uses the address it was opened on |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Production client | Preview client |
| `OWNER_EMAIL` | The owner's Google email, until they first sign in | The same, for each preview database's own owner |
| `OAUTH_PROXY_URL` | Never | `<fixed-preview-url>` |
| `OAUTH_PROXY_SECRET` | Never | `openssl rand -base64 32`, different from `BETTER_AUTH_SECRET` |
| `OAUTH_PROXY_PREVIEW_PATTERN` | Never | This project's preview addresses, e.g. `https://meals-*-<team>.vercel.app` |
| `MCP_API_KEY` | Required: without it production refuses every `/api/mcp` request | Optional |
| `ANTHROPIC_API_KEY`, `HOUSEHOLD_TIMEZONE` | As before | As before |

- [ ] **Production sign-in variables set.** Until `BETTER_AUTH_SECRET`,
      `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are all set, production
      fails closed: nothing is accessible and `/sign-in` says sign-in isn't
      set up.
- [ ] **`OWNER_EMAIL`.** Needed only until the owner first signs in; after
      that it grants nothing. With it unset in production nobody can become
      the owner, but invitations keep working.
- [ ] **Preview sign-in variables set,** including the proxy variables from
      #12 (`OAUTH_PROXY_URL`, `OAUTH_PROXY_SECRET`,
      `OAUTH_PROXY_PREVIEW_PATTERN`).
- [ ] **No `OAUTH_PROXY_*` on Production.** Production ignores them and logs
      a warning, but they should not be there.
- [ ] **Delete the prototype's passcode variable** from Production and
      Preview: the `HOUSEHOLD_…` variable other than `HOUSEHOLD_TIMEZONE`.
      Nothing reads it any more.

### 5. Deployment Protection

- [ ] **Keep Vercel Deployment Protection on for previews.** Previews are for
      the repo owner to test while signed in to Vercel; family members use
      production. The fixed preview that Google redirects to is protected
      too, so a preview sign-in only completes in a browser that can open
      previews.
- [ ] Production stays public: the sign-in gate is its protection.

### Known residual (previews only)

`OAUTH_PROXY_PREVIEW_PATTERN` could match a preview in another Vercel scope
whose slug ends the same way (`meals-*-myteam` would also match
`meals-x-evil-myteam`). Exploiting it still needs the Preview
`OAUTH_PROXY_SECRET`, and exposes at most a preview user's basic Google
profile, never a production sign-in: production refuses hand-backs and
ID-token sign-in is off. Accepted by the stakeholder on #24.

## Hand check

Google sign-in cannot run in CI, so it is checked by hand once the setup
above is in place: on production, then on one preview.

### Production

Use three Google accounts: the owner's (`OWNER_EMAIL`), a second family
member's, and one that is not invited. Use a private window for each person.

- [ ] **Owner signs in with Google.** Open `https://<production-domain>`; it
      redirects to `/sign-in`. "Continue with Google" with the owner's
      account lands on the app. `/family` lists them as Owner; `/account`
      shows their name, email and role.
- [ ] **Owner invites a second person.** On `/family`, invite them by name
      and the email of their Google account. They appear under pending
      invitations, and the page shows the address to pass on.
- [ ] **They sign in with Google.** In another window, the invited account
      signs in and lands on the app. `/family` now lists them as Member and
      the invitation is gone.
- [ ] **An uninvited Google account is refused.** A third Google account
      comes back to `/sign-in` with "This account hasn't been invited", and
      `/family` shows no new member.
- [ ] **A removed member is signed out on their next request.** The owner
      removes the second person on `/family`. In the member's window, the
      next page load goes to `/sign-in` (an API call gets a 401). Re-invite
      them afterwards if they should stay.

### Preview

- [ ] **Sign in on a PR preview other than the fixed one.** With Deployment
      Protection on and signed in to Vercel, open a PR preview (not the
      `epic/accounts` or `auth-proxy` preview) and "Continue with Google". It
      goes through the fixed preview and lands back on the PR preview,
      signed in.

### Result

Not done yet. Record the date, who ran it and the outcome of each step
above, production and preview, here (no real emails).
