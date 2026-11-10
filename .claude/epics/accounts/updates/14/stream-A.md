---
issue: 14
stream: All streams in 14-analysis.md, in order
started: 2026-11-10T21:41:08Z
status: in_progress
---
## Scope
Every stream in `14-analysis.md`, done in order by one implementer.
## Progress
- Stream A (Server Actions) done (2026-11-10T21:44:26Z): `src/app/family/actions.ts` with
  `inviteMemberAction`, `cancelInvitationAction`, `removeMemberAction` and
  `renameFamilyAction`. Each is an `export async function` whose first
  statement is `const owner = await requireOwner();`, then calls the matching
  function in `src/lib/family.ts`. A `FamilyError` comes back as `error` for
  the form; anything else is thrown. A member posting directly is refused by
  `requireOwner()` before the form is read.
- Stream B (page and components): in progress.
