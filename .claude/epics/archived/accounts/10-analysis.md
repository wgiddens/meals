---
issue: 10
title: "Family rules: invitations, roles and invite-only sign-up"
analyzed: 2026-11-10T20:07:28Z
estimated_hours: 7
parallelization_factor: 1.0
---

# Parallel Work Analysis: Issue #10

## Overview
Adds the family model (`role` on `user`, `family`, `invitations`), the
family rules in `src/lib/family.ts`, and Better Auth's creation hooks that
enforce invite-only sign-up and assign roles. Also carries two small
check-script fixes over from the #9 review and removes the temporary Google
warning once the hook is in. The task is `parallel: false` and every stream
builds on the schema, so one implementer works the streams in order.

## Parallel Streams

### Stream A: Schema and migration
**Scope**: `role` column (server-only), `family` single-row table,
`invitations` table with one pending invitation per email; one new
generated migration (`0002_*`). `0001_accounts.sql` is never edited.
**Files**: `src/db/schema.ts`, `drizzle/*`
**Can Start**: immediately
**Estimated Hours**: 1.5
**Dependencies**: none

### Stream B: Family rules
**Scope**: `canSignUp`, `inviteMember`, `cancelInvitation`,
`removeMember`, `renameFamily`, `listFamily`; owner-only checks; no
Next.js request APIs.
**Files**: `src/lib/family.ts`
**Can Start**: after Stream A
**Estimated Hours**: 2.5
**Dependencies**: Stream A

### Stream C: Auth hooks
**Scope**: before-create hook (refuse unless `canSignUp` and the email is
verified), after-create hook (owner bootstrap with "Our family", member role,
invitation accepted), `role` as a server-only additional field; remove the
Google warning.
**Files**: `src/lib/auth.ts`, `.env.example`
**Can Start**: after Stream B
**Estimated Hours**: 2
**Dependencies**: Streams A, B

### Stream D: Carried-over checks (#9 review)
**Scope**: prove `getAuth()` calls `connection()` on every call; remove
the dead `childEnv.PGLITE_DATA_DIR` line; clean up temp directories.
**Files**: `scripts/check-auth.ts`
**Can Start**: immediately (independent of A-C)
**Estimated Hours**: 1
**Dependencies**: none

## Coordination Points
### Shared Files
- `src/lib/auth.ts` is touched by C; D only reads it.
- `scripts/check-accounts.ts` belongs to #15. This task only needs its
  rules to be callable without a browser; it may add minimal assertions to
  `check-auth.ts` but does not create `check-accounts.ts`.
### Sequential Requirements
A → B → C. D can be done at any point.

## Conflict Risk Assessment
Low. Single implementer; no other accounts task runs alongside (#11 depends
on this one).

## Parallelization Strategy
Sequential, one implementation chat.

## Expected Timeline
- With parallel execution: 6h wall time (D beside A-C)
- Without: 7h
- Efficiency gain: 14% (not used: single implementer)
