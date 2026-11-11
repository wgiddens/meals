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
- `BETTER_AUTH_URL` on Preview is the fixed preview's URL, the same value as
  `OAUTH_PROXY_URL` (stakeholder, 2026-11-11); both change together at the
  `auth-proxy` switch-over. check:auth's receiver preview already runs with
  this value end to end.
- `http://localhost:3000` stays on the preview Google client only, never on
  production (stakeholder's decision).
- Review fixes (a706ab6 and the follow-up): Preview database checks, Neon
  branch warning, auth-proxy switch-over order, README exceptions, preview
  hand check.

- Two passkey mentions outside the file list (`src/lib/family.ts`,
  `scripts/check-auth.ts`) reworded as neutral comments (orchestrator
  approved the exception).

## Open
- Unverified: production has no Vercel Deployment Protection.
- Production hand check not yet run.

## PR
- Draft PR: https://github.com/wgiddens/meals/pull/27

<!-- SYNCED: 2026-11-11T03:17:40Z -->
