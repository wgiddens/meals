---
issue: 10
started: 2026-11-10T20:07:28Z
last_sync: 2026-11-10T20:19:34Z
completion: 100%
---

# Issue #10: Family rules: invitations, roles and invite-only sign-up

Streams A-D are implemented on branch `claude/issue-10-family-rules` and are
awaiting review in a draft PR into `epic/accounts`. See `stream-A.md` for
details. The task stays `in-progress` until it is reviewed and merged.

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
