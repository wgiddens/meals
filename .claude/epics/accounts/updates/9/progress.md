---
issue: 9
started: 2026-11-10T19:19:03Z
last_sync: 2026-11-10T19:19:03Z
completion: 90%
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
