---
issue: 15
started: 2026-11-10T21:41:08Z
last_sync: 2026-11-10T21:41:08Z
completion: 90%
---

# Issue #15: Automated checks for the account rules

Stream A in `15-analysis.md` is implemented on
`claude/issue-15-account-checks` (see `stream-A.md`). Draft PR next.

## Verified
- `npm run typecheck`, `npm run lint`, `npm run smoke` (check:import,
  check:auth, check:accounts, smoke.ts), `npm run check:accounts` and
  `env -u DATABASE_URL npm run build` pass.
- `check:accounts` passes with an empty environment (`env -i`), and with
  hostile values set (`NODE_ENV=production`, Google, `BETTER_AUTH_SECRET`,
  a bogus `DATABASE_URL`): the script clears or overrides them.
- `check:accounts` passes twice in a row against a throwaway local
  Postgres 16 (`CHECK_ACCOUNTS_DATABASE_URL`), leaving no rows or test
  objects behind.
- Mutation run: see `stream-A.md`.

## Not changed
- `scripts/check-auth.ts` keeps its overlapping family-rule assertions;
  see the PR's "Decisions and open questions".
