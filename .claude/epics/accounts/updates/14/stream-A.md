---
issue: 14
stream: All streams in 14-analysis.md, in order
started: 2026-11-10T21:41:08Z
status: completed
---
## Scope
Every stream in `14-analysis.md`, done in order by one implementer.
## Progress
- Stream A (Server Actions) done: `src/app/family/actions.ts` with
  `inviteMemberAction`, `cancelInvitationAction`, `removeMemberAction` and
  `renameFamilyAction`. Each is an `export async function` whose first
  statement is `const owner = await requireOwner();`, then calls the matching
  function in `src/lib/family.ts`. A `FamilyError` comes back as `error` for
  the form; anything else is thrown. A member posting directly is refused by
  `requireOwner()` before the form is read.
- Stream B (page and components) done (2026-11-10T21:49:16Z): `src/app/family/page.tsx`
  (dynamic part inside `<Suspense>`), `src/app/family/loading.tsx`, and the
  owner controls in `src/components/FamilyControls.tsx` (invite form with the
  app address afterwards, rename, cancel invitation, remove with one inline
  confirmation). Buttons and inputs are at least 44 px.
- Checked by hand on `next dev` at 375 px: invite, duplicate / already-member /
  invalid-email errors, cancel, rename, remove with confirmation, the member
  view without controls, and a member posting each action directly (refused
  with NOT_OWNER, nothing changed; the same call as the owner works).
- typecheck, lint, smoke and `env -u DATABASE_URL npm run build` pass.
