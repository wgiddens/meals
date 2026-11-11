---
issue: 16
started: 2026-11-11T03:10:19Z
last_sync: 2026-11-11T03:17:40Z
completion: 90%
---

# Issue #16: Progress

Docs, cleanup and checks done (see stream-A.md). What remains is the
production hand check, which only the repo owner can run; its list and a
Result section are in `docs/DEPLOY.md`.

## Verified
- `npm run typecheck`, `npm run lint`, `npm run smoke`,
  `env -u DATABASE_URL npm run build`: pass.
- `grep -ri "HOUSEHOLD_PASSCODE\|requireHousehold\|household passcode" .`
  finds nothing outside `.git/`, `.claude/` and `node_modules/`.
- No "Supabase" left in README, `.env.example`, docs or `src/`.

## Decisions
- Setup checklist and hand check live in a new `docs/DEPLOY.md`;
  ARCHITECTURE describes how accounts work and links there.
- The checklist must say to delete the passcode variable from Vercel, but the
  grep criterion forbids its name: it says "the `HOUSEHOLD_…` variable other
  than `HOUSEHOLD_TIMEZONE`".
- Two Google clients per #24 (the spec's single-client wording predates it):
  production's redirect URI on the production domain; preview's on the fixed
  preview plus `localhost:3000`.
- `BETTER_AUTH_URL` on Preview: documented as "leave unset" (checked in the
  installed oAuthProxy: skipping the proxy compares the request's origin with
  `productionURL`, so either works).

## Open
- What `BETTER_AUTH_URL` is actually set to on Vercel Preview (unverified).
- Two passkey mentions outside this task's files: `src/lib/family.ts:263`
  ("such as passkeys", an example) and `scripts/check-auth.ts:1013`.
- Production hand check not yet run.

## PR
- Draft PR: https://github.com/wgiddens/meals/pull/27

<!-- SYNCED: 2026-11-11T03:17:40Z -->
