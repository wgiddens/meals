---
issue: 9
started: 2026-11-10T19:19:03Z
last_sync: 2026-11-10T19:58:25Z
completion: 100%
---

# Issue #9: Sign-in foundation with Better Auth

Worked as a single stream on the session branch `claude/youthful-fermat-xfgeyu`
(no epic worktree in this cloud session). Implementation is complete and
awaiting review.

## Done
- `better-auth` and `@better-auth/passkey` 1.7.20 installed.
- `src/lib/auth.ts`: lazy `getAuth()` over `getDb()` with the Drizzle adapter;
  passwords off; Google only when both client variables are set; 90-day
  sessions renewed daily; cookie cache off; a missing secret throws in
  production.
- `user`, `session`, `account`, `verification` tables in
  `src/db/schema.ts`; migration `drizzle/0001_accounts.sql`.
- `src/app/api/auth/[...all]/route.ts`; `/api/auth/` exempt in `src/proxy.ts`.
- `scripts/check-auth.ts` (`npm run check:auth`, part of `npm run smoke`).

## Verified
- `check:auth` passes on embedded PGlite and on a real Postgres 16 server
  through postgres-js (`CHECK_AUTH_DATABASE_URL`).
- Built app: `GET /api/auth/ok` 200 with the passcode gate on; gated pages
  still redirect; with no secret in production the route answers 500.
- Dev with no environment variables: `GET /api/auth/ok` 200.
- typecheck, lint, smoke and build pass.

## Notes for later tasks
- `internalAdapter.createUser` takes a provisioning source and runs a
  `user.validateUserInfo` gate. That gate is a candidate for the invite-only
  rule in issue #10, alongside or instead of a database hook.
- Better Auth warns when `BETTER_AUTH_URL` is unset and derives the origin
  from the request. Harmless locally; set it on the deployment.
- Not verified against Neon itself, only a local Postgres 16.

## Review follow-up (branch `claude/issue-9-review-fixes`)

PR #17 merged into `epic/accounts`; code review found the items below, fixed
in a follow-up PR against `epic/accounts`.

- `getAuth()` awaits `getDb()` (and so `connection()`) on every call before
  touching its cache, and passes the handle to `createAuth(db)`.
  `betterAuth()` is synchronous, so the instance itself is cached, not a
  promise, and a failed build (missing secret) caches nothing.
- The instance is cached at module scope; the database stays on
  `globalThis`. Checked with a temporary probe: `next start` builds one
  instance shared by two routes; in `next dev` an edit to `auth.ts` rebuilds
  it (once per route that imports it), then it stays put.
- `better-auth` and `@better-auth/passkey` pinned to `~1.7.20`; installed
  version unchanged (1.7.20).
- `scripts/check-auth.ts` now asserts the `EMAIL_PASSWORD_SIGN_UP_DISABLED`
  code, cookie cache off, `expiresIn` of 90 days, renew-on-use through
  `get-session` with a signed cookie, and that a fresh process with
  `NODE_ENV=production` and no secret gets a rejection from `getAuth()`.
  Each new assertion was seen failing against a deliberately broken config.
  Passes on PGlite and on a local Postgres 16 through postgres-js.
- Warning in `.env.example` and `src/lib/auth.ts`: no Google credentials on
  any deployment until #10's invite-only rule is merged. #10 removes it.
- Epic now says each task adds its own migration and merged migrations are
  never rewritten.

Status stays in-progress until the follow-up PR merges.

## Closed
- 2026-11-10T20:07:09Z: PR #17 and the review-fix PR #18 merged into `epic/accounts`. Review
  of #18 approved; its remaining minor findings moved to #10 (check that
  `getAuth()` stays request-time; drop the dead `PGLITE_DATA_DIR` line) and
  to notes in #11 and #12 (`use cache: private` rejects `connection()`).
