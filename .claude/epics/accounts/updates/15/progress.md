---
issue: 15
started: 2026-11-10T21:41:08Z
last_sync: 2026-11-10T22:05:00Z
completion: 90%
---

# Issue #15: Automated checks for the account rules

Stream A in `15-analysis.md` is implemented on
`claude/issue-15-account-checks` (see `stream-A.md`). Draft PR #23 into `epic/accounts`, awaiting review.

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

## Added at the stakeholder's request (via the orchestrator)
- `scripts/smoke.ts`: the Server Action scan requires every exported action
  in `src/app/family/actions.ts` to start with `await requireOwner()`
  (`requireMember()` is not enough there). With the file absent (it arrives
  with #14's PR #22) there is nothing to check. Fixtures prove a
  `requireMember()` action fails and a `requireOwner()` one passes. Also
  checked on real files: a temporary `actions.ts` with `requireMember()`
  makes smoke exit 1 and with `requireOwner()` exit 0; PR #22's
  `actions.ts` passes (13 actions scanned on that branch).
- typecheck, lint, smoke, check:accounts and `env -u DATABASE_URL` build
  pass again.

## Not changed
- `scripts/check-auth.ts` keeps its overlapping family-rule assertions;
  see the PR's "Decisions and open questions".

<!-- SYNCED: 2026-11-10T22:05:00Z -->
