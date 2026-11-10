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

## Remaining
- Review, then the orchestrator marks the PR ready and the stakeholder merges.
