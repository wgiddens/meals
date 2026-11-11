---
issue: 13
started: 2026-11-11T02:39:38Z
last_sync: 2026-11-11T02:54:51Z
completion: 100%
---

# Issue #13: Passkeys: add, remove and sign in

Implemented on branch `claude/issue-13-passkeys`; draft PR #25 into
`epic/accounts`.

## Acceptance criteria
- [x] Plugin enabled in `getAuth()`; `passkey` table in the schema with
  migration `drizzle/0003_passkeys.sql`.
- [x] `/account` lists passkeys (name, added date), adds and removes them.
- [x] `/sign-in` offers "Use a passkey"; a registered passkey signs in
  without Google (check-accounts 11.3–11.4; browser check).
- [x] Only a signed-in member can add one; it never creates an account
  (11.5–11.8, 11.14).
- [x] `removeMember` deletes passkeys, and the removed member's passkey no
  longer signs in (11.12–11.14; browser check).
- [x] `check-accounts.ts` asserts it (11.12).
- [x] Relying party from `BETTER_AUTH_URL`, `localhost` locally (11.15–11.17,
  12.5–12.9); previews use `VERCEL_BRANCH_URL` (11.18, 12.1–12.4).
- [x] No passkey controls without browser support, or off the rpID's host
  (browser check).
- [x] typecheck, lint, smoke and `env -u DATABASE_URL npm run build` pass.

## Checks run
- `npm run check:accounts` on embedded PGlite, and on a throwaway local
  Postgres 16 (`CHECK_ACCOUNTS_DATABASE_URL`).
- Browser: Chromium with a CDP virtual authenticator (ctap2, internal,
  resident key, user verification) against `next start` (NODE_ENV
  production, `BETTER_AUTH_URL=http://localhost:3100`) on a throwaway local
  Postgres. Covered: Pat adds "Pat's phone" (listed with "Added 11 Nov 2026",
  a discoverable credential for rpId `localhost`), signs out, "Use a passkey"
  signs in and returns to `next=/account`; the owner sees only their own
  passkeys, removes theirs in the UI, and it then no longer signs in; after
  `removeMember(Pat)` Pat's passkey rows and session are gone, and Pat's
  still-held credential gets "isn't on any account here" and creates no
  user; with `PublicKeyCredential` removed, or on `127.0.0.1`, neither page
  shows passkey controls (the list still shows on `/account`).
- 390 px: no layout problems in the passkey section or on `/sign-in`.

## Decisions
- **Previews (option A, the stakeholder's choice via the orchestrator):**
  rpID is the `VERCEL_BRANCH_URL` host and the origin exactly
  `https://<VERCEL_BRANCH_URL>`, because a preview's `BETTER_AUTH_URL` is the
  fixed proxy preview. Controls show only where the hostname equals the rpID.
- **Production:** explicit origin from `BETTER_AUTH_URL`; passkeys off when
  it is unset (fail closed rather than bind to `localhost`).
- **Fresh session to add a passkey:** kept Better Auth's default (signed in
  within a day). Older sessions get "sign out, sign in again with Google".
- **Removing a passkey** stays available without WebAuthn support (it needs
  none), so a lost device can be removed from any browser. Add and sign-in
  controls are hidden.
- **No change to `removeMember`:** passkeys go with the user row through
  `ON DELETE CASCADE`, which check-accounts proves.
- The list is read on the server (own passkeys only, by member id); add and
  remove go through Better Auth's endpoints, which check ownership.

## Review fixes (PR #25)
- 1: register with no `name` (the plugin also used it as the WebAuthn user
  name, so a shared device's picker showed "iPad" instead of the member);
  the label is set afterwards with `updatePasskey`. Check 11.1b asserts the
  registration options' user is the member's email.
- 3: a cancelled passkey prompt (`ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY`)
  shows "Passkey sign-in was cancelled."
- 4: the stale-session message says "sign in again" (Google or a passkey).
  The up-front hint was skipped: the page doesn't read the session's
  creation time today.
- 5 (the stakeholder's decision): check-accounts 11.19–11.22 assert
  `passkeysAvailable()` with a stubbed browser: true only with WebAuthn and
  the hostname exactly the rpID; false without WebAuthn, on another host, a
  subdomain or a lookalike.
- Remove control: stays visible without WebAuthn (the stakeholder's
  decision).
- 2 (authenticatorSelection): open with the stakeholder.
- Rerun: typecheck, lint, smoke, build, and the browser check (19 steps).

## Not done here
- `.env.example` and the docs don't yet describe passkeys and the
  `BETTER_AUTH_URL` requirement; that's #16's documentation task.
- Not tried on a real phone or on a Vercel deployment.

<!-- SYNCED: 2026-11-11T02:54:51Z -->
