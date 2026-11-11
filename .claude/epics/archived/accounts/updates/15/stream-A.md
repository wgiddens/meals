---
issue: 15
stream: All streams in 15-analysis.md, in order
started: 2026-11-10T21:41:08Z
status: completed
---
## Scope
Every stream in `15-analysis.md`, done in order by one implementer. There
is one stream (A: account rule checks).

## Progress
- Stream A done: `scripts/check-accounts.ts` (58 assertions, one numbered
  section per acceptance criterion) and `package.json` (`check:accounts`,
  and `smoke` now runs it, so CI does too). No other files changed.
- Real code paths only: Better Auth's `handleOAuthUserInfo` (the OAuth
  callback's sign-up), `internalAdapter.createUser`, `auth.api.getSession`,
  `auth.api.updateUser` and `POST /api/auth/update-user` through
  `auth.handler`, the `src/lib/family.ts` actions, and `memberForRequest`,
  `lookUpMember`, `devOwnerAllowed` and `ensureDevOwner` from the member gate.
- Test-only instrumentation: an insert-audit trigger on `"user"` in the
  throwaway database, so "cannot create a user" also catches a row that is
  written and deleted again by the after-create fallback. Dropped at the end.
- Mutation run: 21 single-rule breaks in `family.ts`, `auth.ts`, `gate.ts`,
  `package.json` and `ci.yml`, each restored afterwards. 19 fail the script
  (exit 1). The 2 that pass remove only the app-side half of a rule that
  the database also enforces: the pending-invitation pre-check (unique
  index) and the explicit session delete (ON DELETE CASCADE). Removing both
  halves of each fails the script.
