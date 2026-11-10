---
issue: 12
started: 2026-11-10T21:41:08Z
last_sync: 2026-11-10T22:05:00Z
completion: 100%
---

# Issue #12: Sign-in page with Google, sign out and My account

All three streams in `12-analysis.md` are implemented on
`claude/issue-12-sign-in-account` (see `stream-A.md`), in three commits.
Files touched are only those the spec lists. Draft PR #24 into `epic/accounts`.

## Verified
- `npm run typecheck`, `npm run lint`, `npm run smoke` and
  `env -u DATABASE_URL npm run build` pass. The smoke scan finds 11 guarded
  Server Actions, the two new ones included.
- **Preview proxy, against the library's real handler** (throwaway script,
  not committed): two Better Auth instances built by our own `getAuth()`,
  a fixed "proxy" deployment and a preview, each with its own temporary
  PGlite, `NODE_ENV=production`, Vercel-style env, and Google's token
  endpoint stubbed. 31 checks pass:
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
- **`OAUTH_PROXY_SECRET`** seals the hand-off instead of
  `BETTER_AUTH_SECRET`. Since the review it is required and must differ
  from `BETTER_AUTH_SECRET` (see "Review fixes").
- **Sign out is a Server Action** calling `auth.api.signOut` and copying
  Better Auth's expiring cookie through `cookies()`; no client component, so
  it works before JavaScript loads. The display name form is a plain form
  action; its outcome comes back in the query string (`?saved=name`,
  `?error=name-empty|name-long`).
- **Display name** is trimmed, inner whitespace and control characters
  collapsed to one space, 1-80 characters (counted as code points).
- **Signed-in redirect** goes to the safe `next` path, which is `/` when
  there is none, as #11's placeholder did.

## Review fixes (review of PR #24)
1. **Forged hand-back on the fixed deployment (should-fix, security).**
   The fixed deployment registered the plugin's hand-back endpoints, so a
   payload sealed with `OAUTH_PROXY_SECRET` alone signed in as the owner
   there. Under the old plan, production would have accepted it too.
   - `oauthProxyRole(env)` is `off`, `fixed` or `receiver`, decided from the
     environment only. It is `fixed` when `VERCEL_ENV=production`, or when
     `VERCEL_BRANCH_URL` is `OAUTH_PROXY_URL`. A `fixed` deployment gets a
     `hooks.before` plugin that refuses `/callback/:id/oauth-proxy` and
     `/oauth-proxy-callback` (redirect to
     `/sign-in?error=proxy_hand_back_refused`) before the plugin runs. Its
     own sign-ins and the proxying for previews still work.
   - The plugin has no option to keep its hand-back endpoint off, so a
     `fixed` deployment refuses hand-backs outright. Previews hold the proxy
     secret, but production never accepts anything sealed with it.
   - `OAUTH_PROXY_SECRET` is required with `OAUTH_PROXY_URL` and must differ
     from `BETTER_AUTH_SECRET`; otherwise the proxy stays off and an error is
     logged.
   - Implicit linking: `account.accountLinking.disableImplicitLinking: true`
     (the stakeholder chose option A). A Google sign-in for an existing
     member's email from another Google account (`sub`) is refused with
     `account_not_linked`, and the sign-in page explains it. A re-created
     Google account needs the owner to remove and re-invite the person.
2. **Hand-back bound to the browser (stakeholder: do it if clean).** On a
   preview, a `hooks.before` plugin unseals the hand-back with
   `OAUTH_PROXY_SECRET` and requires its state to equal the signed `state`
   cookie that Better Auth sets in the browser starting sign-in (database
   state strategy). Otherwise it redirects to `/sign-in?error=state_mismatch`.
   There is no fork or patch. It uses the public `symmetricDecrypt` and the
   plugin's key derivation (HKDF-SHA256, purpose `oauth-proxy-profile`),
   re-derived with `node:crypto`. If a later Better Auth changes that, every
   hand-back is refused (fails closed) and check:auth fails.
3. **Deployment Protection:** no code change. Previews stay for the
   stakeholder only, with protection on; it goes in #16's docs.
4. **`trustedOrigins()` checks (minor).** check:auth now asserts:
   - a preview trusts exactly its own two addresses and the proxy;
   - no wildcard in any environment, except `localhost:*` outside
     production;
   - localhost only outside production;
   - production with the proxy off trusts nothing extra;
   - the running instance doesn't trust an arbitrary `*.vercel.app`.

### Verified (review fixes)
- typecheck, lint, smoke (386 checks) and `env -u DATABASE_URL npm run build`
  pass.
- check:auth, new main-process checks:
  - the trusted-origins assertions above;
  - the owner's email from another `sub` is refused and not linked, while
    the same `sub` still signs in.
- check:auth proxy child process (22 checks): three deployments (fixed,
  preview, production-as-proxy), each with its own PGlite, and Google's
  token endpoint stubbed:
  - the roles;
  - the preview flow completes through the fixed deployment;
  - the hand-back opened in a browser with no cookies, or with its own
    sign-in's state cookie, is refused and creates no session;
  - a forged hand-back is otherwise valid (a preview accepts it with the
    owner's own `sub`; with another `sub` it gets `account_not_linked`);
  - the fixed deployment and production refuse forged hand-backs on both
    paths, writing no user or session;
  - their own sign-ins still complete directly.
- Mutations, each applied by hand, now fail `npm run check:auth`:
  - no hand-back refusal;
  - `https://*.vercel.app` trusted;
  - localhost trusted in production;
  - production not `fixed`;
  - no browser binding;
  - implicit linking back on.
- By hand on `next start`: a forged hand-back (built from
  `OAUTH_PROXY_SECRET` only) to a server with `VERCEL_ENV=production` got
  `302 /sign-in?error=proxy_hand_back_refused` and no cookie. The same
  server configured as a receiver accepted it and set a session cookie, so
  the forgery is real.
- Real browser, two `next start` servers on different sites (preview on
  `localhost:3105`, fixed on `127.0.0.1:3106`), Playwright:
  - Google was sent to the fixed deployment and the person was signed in on
    the preview, so the SameSite=Lax state cookie survives the cross-site
    redirect chain;
  - a fresh hand-back URL opened in another browser got
    `error=state_mismatch` and no session, then still worked in the
    starting browser;
  - the fixed deployment refused it.

## Re-check fixes (re-check of PR #24 at eaa3742)
Finding 1: the fixed deployment (and production acting as the proxy)
forwarded a proxied sign-in to whatever `callbackURL` was sealed in the
state package. The reviewer sent a package sealed for `https://evil.example`
with an attacker-chosen PKCE verifier and got a 302 to evil.example carrying
an unsealable profile. Production also accepted Google ID-token sign-in.
- **(i)** The Google provider now has `disableIdTokenSignIn: true`, so
  `/sign-in/social` with `idToken` gets 404 `ID_TOKEN_NOT_SUPPORTED`.
- **(ii)** A fixed deployment runs `guardProxyDestinations` as a
  `hooks.before` on `/callback/:id`, ahead of the plugin. It unseals the
  state package and its state with `OAUTH_PROXY_SECRET`. The destination
  and the error address must be one of:
  - a safe path on itself;
  - its own origin (`BETTER_AUTH_URL` or `OAUTH_PROXY_URL`);
  - an origin matching `OAUTH_PROXY_PREVIEW_PATTERN`.

  Otherwise it redirects to `/sign-in?error=proxy_destination_refused`
  before any Google exchange. If the package unseals but its state doesn't,
  that is refused too. Callbacks that aren't proxy packages (its own
  sign-ins) are left to Better Auth.
- **`OAUTH_PROXY_PREVIEW_PATTERN`** (new, documented in `.env.example`) is
  one pattern such as `https://meals-*-<team>.vercel.app`:
  - https only, with a host only;
  - exactly one `*`, inside the first host label, with fixed text on both
    sides;
  - `*` matches `[a-z0-9-]+` only, never a dot.

  Anything else, `https://*.vercel.app` and `https://meals-*.vercel.app`
  included, is treated as unset. Unset, the fixed deployment hands back to
  nothing but itself.
- (iii) Whether production should be the proxy, and whether secrets and the
  Google client are shared, is with the stakeholder. The deployment model and
  the PR's Vercel instructions are unchanged until then.

### Verified (re-check fixes)
- typecheck, lint, smoke (422 checks) and `env -u DATABASE_URL npm run build`
  pass.
- check:auth main process:
  - 12 refused patterns (unset, empty, `https://*.vercel.app`,
    `https://meals-*.vercel.app`, `https://*-fam.vercel.app`, http, trailing
    slash, port, two stars, no star, star outside the first label, no
    suffix);
  - allowed and refused destinations: evil.example, a look-alike with a dot
    inside the wildcard, a `.evil.example` suffix, http, another project, a
    userinfo trick, `//evil.example`, `javascript:`, empty.
- check:auth proxy child process:
  - forged packages with an attacker PKCE verifier are refused before any
    Google token exchange, on the fixed deployment and on production, for a
    foreign destination, a look-alike destination and a foreign error
    address;
  - a matching preview destination is still handed back;
  - with the pattern unset, only the fixed deployment itself is a
    destination;
  - ID-token sign-in is refused on the preview, the fixed deployment and
    production;
  - every earlier check still passes.
- Mutations: removing the destination guard makes check:auth fail; the
  fixed deployment then sends `302 https://evil.example/...&profile=…`.
  Removing `disableIdTokenSignIn` makes it fail too.
- By hand on `next start` (`VERCEL_ENV=production`, pattern set, Google's
  token endpoint stubbed):
  - a package sealed for evil.example gets
    `302 /sign-in?error=proxy_destination_refused`;
  - the same package for `https://meals-abc123-fam.vercel.app` gets its
    hand-back;
  - `/sign-in/social` with an `idToken` gets 404 `ID_TOKEN_NOT_SUPPORTED`.
- Not re-run: the two-site browser test from the first fixes. Its preview
  ran on `http://localhost`, which an https-only pattern cannot match. The
  same flow, with a matching preview, is covered by the check:auth child.

## Open
- **Residual:** whoever holds `OAUTH_PROXY_SECRET` (the Preview
  environment) can, from their own browser, forge a hand-back to a preview
  and sign in there as a member whose Google `sub` they know, or as the
  owner email before an owner exists. Previews only, never production. They
  could also make the fixed deployment forward a victim's Google profile to
  an address of their choosing, but only if the victim completes a Google
  sign-in from a link the attacker crafted. The second is now closed: the
  fixed deployment only hands back to itself or to addresses matching
  `OAUTH_PROXY_PREVIEW_PATTERN`. The first still needs the Preview secrets.
- Vercel lets any team name a project, so a project named like
  `meals-x-<team>` in another team could have a production domain matching
  the preview pattern. Whether Vercel reserves team-slug suffixes is not
  verified. The pattern is still far narrower than `*.vercel.app`.
- `HOUSEHOLD_PASSCODE` is still described in `.env.example`, `README.md`
  and `docs/ARCHITECTURE.md`. Left for #16, which owns the docs.

<!-- SYNCED: 2026-11-10T22:05:00Z -->
