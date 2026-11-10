---
issue: 12
started: 2026-11-10T21:41:08Z
last_sync: 2026-11-10T21:41:08Z
completion: 100%
---

# Issue #12: Sign-in page with Google, sign out and My account

All three streams in `12-analysis.md` are implemented on
`claude/issue-12-sign-in-account` (see `stream-A.md`), in three commits.
Files touched are only those the spec lists.

## Verified
- `npm run typecheck`, `npm run lint`, `npm run smoke` and
  `env -u DATABASE_URL npm run build` pass. The smoke scan finds 11 guarded
  Server Actions, the two new ones included.
- **Preview proxy, against the library's real handler** (throwaway script,
  not committed): two Better Auth instances built by our own `getAuth()`,
  a fixed "proxy" deployment and a preview, each with its own temporary
  PGlite, `NODE_ENV=production`, Vercel-style env, and Google's token
  endpoint stubbed. 30 checks pass:
  - sign-in starts on the preview and Google is given
    `<OAUTH_PROXY_URL>/api/auth/callback/google`; the proxy exchanges the
    code with the same `redirect_uri`;
  - the proxy creates no user and hands back to the preview's own branch
    address; the preview creates the owner in its own database, sets a
    working session cookie and lands on the `next` path;
  - an uninvited account lands on the preview's
    `/sign-in?next=%2Fplan&error=NOT_INVITED` with no row created;
  - replaying the hand-back (`state_mismatch`) and a tampered profile
    (`invalid_profile`) are refused;
  - a sign-in started on the fixed address itself is not proxied and
    completes there;
  - a foreign `callbackURL` (`https://evil.vercel.app/x`, `//evil.com/x`)
    or `errorCallbackURL` is refused with 403 on the preview and on the
    proxy; a sign-in posted from a foreign page is refused;
  - the preview trusts only its two own addresses and the proxy; no
    wildcard, no localhost in a production build; `evil.vercel.app` and
    `<branch>.vercel.app.evil.com` are not trusted;
  - `auth.api.signOut` expires the session cookie and the old cookie then
    finds no session.
- **Production build end to end in a browser** (`next start`, temporary
  PGlite, fake Google client, Google's token endpoint stubbed in the server
  with a preloaded module, Playwright at 375 px intercepting
  `accounts.google.com`):
  - an uninvited account comes back to `/sign-in?next=%2Faccount&error=NOT_INVITED`
    showing "This account hasn't been invited", with no session; the
    database afterwards holds only the owner;
  - the owner signs in and lands on `/account` (the `next` path), which
    shows email and role "Owner";
  - signed in, `/sign-in` sends them to `/`;
  - the display name changes; Sign out returns to `/sign-in`, the cookie is
    gone and `/account` then redirects to sign-in; signing in again keeps
    the new name.
- **Not configured** (`next start`, no Google or secret): `/sign-in` says
  "Sign-in isn't set up yet" and shows no button.
- **Dev owner** (`next dev`, no Google): `/sign-in?next=/plan` goes to
  `/plan`, `/sign-in` to `/`; `/account` shows Dev owner, its email and
  Owner; the server trims and collapses the name, refuses blank and
  81-character names (browser validation bypassed) and accepts 80; Sign out
  goes to `/sign-in`, which sends the dev owner straight back to `/`.
- **375 px**: no horizontal scroll on either page; Google button 309×48,
  Save name and Sign out 309×44, name field 44 tall; the sign-in page has
  no text fields.

## Decisions
- **Proxy configuration.** `OAUTH_PROXY_URL` turns the plugin on and is its
  `productionURL`. Set it on the fixed deployment itself too: that
  deployment needs the plugin to receive proxied callbacks, and its own
  sign-ins are skipped because the origins match. Unset means every
  deployment talks to Google directly.
- **Trusted origins** are `BETTER_AUTH_URL` (Better Auth's own), the proxy
  origin, and on `VERCEL_ENV=preview` that deployment's `VERCEL_URL` and
  `VERCEL_BRANCH_URL`; outside production `http://localhost:*` and
  `http://127.0.0.1:*`. No preview pattern at all: each preview trusts only
  itself, which is narrower than "this project's previews". The proxy never
  checks where it sends people; it trusts the address sealed in the state,
  which only a deployment with the shared secret can seal, after checking
  it against this list.
- **Absolute return addresses** from the Google button (page origin plus
  `next`), so that a refusal or cancel at the proxy still returns to the
  preview rather than the proxy's own `/sign-in`.
- **`onAPIError.errorURL = "/sign-in"`**, so a failure without an error
  address (a tampered hand-back, a lost state) comes to the sign-in page's
  generic message rather than Better Auth's error page on the proxy.
- **Optional `OAUTH_PROXY_SECRET`** seals the hand-off instead of
  `BETTER_AUTH_SECRET`, so when production later becomes the proxy,
  previews need not share production's main secret.
- **Sign out is a Server Action** calling `auth.api.signOut` and copying
  Better Auth's expiring cookie through `cookies()`; no client component, so
  it works before JavaScript loads. The display name form is a plain form
  action; its outcome comes back in the query string (`?saved=name`,
  `?error=name-empty|name-long`).
- **Display name** is trimmed, inner whitespace and control characters
  collapsed to one space, 1-80 characters (counted as code points).
- **Signed-in redirect** goes to the safe `next` path, which is `/` when
  there is none, as #11's placeholder did.

## Open
- **Hand-back is not bound to the browser.** The plugin's last step skips
  the state cookie check, and with a database the state lives in the
  `verification` table. A hand-back URL opened in another browser within 60
  seconds, before it is used, signs that browser in. The URL only exists in
  the signing-in person's own redirect chain. This is the library's design;
  noted, not worked around.
- **Vercel Deployment Protection** on previews would stop family members
  without Vercel access from opening a preview at all. Not code; for #16's
  checklist.
- `HOUSEHOLD_PASSCODE` is still described in `.env.example`, `README.md`
  and `docs/ARCHITECTURE.md`. Left for #16, which owns the docs.
