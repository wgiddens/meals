---
issue: 10
started: 2026-11-10T20:07:28Z
last_sync: 2026-11-10T20:37:24Z
completion: 100%
---

# Issue #10: Family rules: invitations, roles and invite-only sign-up

Streams A-D are implemented on branch `claude/issue-10-family-rules` and are
awaiting review in a draft PR into `epic/accounts`. See `stream-A.md` for
details. The task stays `in-progress` until it is reviewed and merged.

## Review fixes (2026-11-10T20:37:24Z)
Review of PR #20 found three issues; all are fixed on the same branch.
- **Blocker: every Google sign-up failed.** Better Auth parses a new OAuth
  user's fields before any hook runs, and refused `role` (required, server
  only, no default) with `MISSING_FIELD`. Fixed by giving `role` a
  `defaultValue` of `member`; the before hook still sets the real role.
  `check-auth.ts` now signs up through `handleOAuthUserInfo`, the function
  the OAuth callback calls, so the profile parsing, user insert, account
  link and session all run. The check fails with `MISSING_FIELD` without
  the fix.
- **A stale pending invitation could let a removed member back in.**
  - With `transaction: false`, the user row commits before the after hook
    runs. If accepting the invitation failed, it stayed pending.
  - Now `removeMember` cancels pending invitations for the member's email
    in its transaction.
  - `signUpRole` ignores a pending invitation whose email already belongs
    to a user, and `listFamily` does not show one.
  - The adapter still runs with `transaction: false`, so the user and
    account inserts are not atomic.
- **Race between cancelling and signing in.** If no pending invitation is
  left to accept when the after hook runs, `completeSignUp` deletes the new
  user (the linked account cascades) and the hook throws `NOT_INVITED`
  before a session is created. The check simulates the cancel while the
  Google account is being linked.
- **OWNER_EMAIL decision is now proven by the checks.** With `OWNER_EMAIL`
  unset and no owner, `canSignUp` is false and Google sign-up is refused
  with `NOT_INVITED` and no row. With it unset after the owner exists, an
  invitation still works.
- Each fix was confirmed by reverting it and seeing a check fail.
  `check:auth` passes on PGlite (73 checks) and on a local Postgres 16
  (74 checks).

## Notes for later tasks
- #11 (dev owner): the before-create hook refuses every email that is not
  `OWNER_EMAIL` (while there is no owner) or invited, and refuses any
  unverified email. The built-in dev owner therefore can't come from
  Better Auth's `createUser` unless `OWNER_EMAIL` matches it. Insert it
  directly with Drizzle (role `owner`, plus the family row) or call
  `completeSignUp`.
- #12 (sign-in page): a refused Google sign-in redirects to the error URL
  with `error=NOT_INVITED` or `error=EMAIL_NOT_VERIFIED`.
- #14 (family page): `FamilyError.message` is written to be shown as is;
  `FamilyError.code` is for branching.
- #15: the rules are exercised in `scripts/check-auth.ts`. They can move to
  `scripts/check-accounts.ts` when that file exists.
- #16: document `OWNER_EMAIL` in `.env.example` and the README. This task
  only replaced the Google warning there.
