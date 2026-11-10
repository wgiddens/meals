---
issue: 14
started: 2026-11-10T21:41:08Z
last_sync: 2026-11-10T22:05:00Z
completion: 90%
---

# Issue #14: Family page: members, invitations and owner controls

Both streams done on branch `claude/issue-14-family-page`; draft PR into
`epic/accounts` awaiting review: https://github.com/wgiddens/meals/pull/22

<!-- SYNCED: 2026-11-10T22:05:00Z -->

## Done
- Server Actions (`src/app/family/actions.ts`), all starting with `requireOwner()`.
- `/family` page, loading state and owner controls.
- Checked by hand on `next dev` (dev owner, then sign-in mode with a seeded
  member session) at 375 px. See `stream-A.md`.

## Review fixes (PR #22)
- Invite inputs are now 16 px (`text-base`) so iOS Safari doesn't zoom on focus.
- Invite email capped at 254 characters: `maxLength` on the input, and the
  action returns "That email address is too long." as a form error. The name
  was already capped at 100 (input and `src/lib/family.ts`).
- Checked on `next dev` at 375 px; typecheck, lint, smoke and build pass.

## Remaining
- Review, then the orchestrator marks the PR ready and the stakeholder merges.
