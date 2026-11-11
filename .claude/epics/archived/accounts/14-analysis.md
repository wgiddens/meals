---
issue: 14
title: "Family page: members, invitations and owner controls"
analyzed: 2026-11-10T21:41:08Z
estimated_hours: 5
parallelization_factor: 1.0
---

# Parallel Work Analysis: Issue #14

## Overview
`/family` lists members and pending invitations for everyone, with owner-only controls (invite, cancel, remove with confirmation, rename) posting to guarded Server Actions over `src/lib/family.ts`.

Runs in parallel with the other tasks the stakeholder started together after
#11 (#12, #14, #15), each in its own implementation chat and PR.

## Parallel Streams

### Stream A: Server Actions
**Scope**: `src/app/family/actions.ts`: each `export async function` starts with `requireOwner()` and calls `src/lib/family.ts`; rule errors returned for display
**Files**: `src/app/family/actions.ts`
**Can Start**: immediately
**Estimated Hours**: 1.5
**Dependencies**: none

### Stream B: Page and components
**Scope**: `/family` page, loading state, member and invitation lists, owner controls, post-invite address from `BETTER_AUTH_URL` or the request origin
**Files**: `src/app/family/page.tsx`, `src/app/family/loading.tsx`, `src/components/` (family components)
**Can Start**: after Stream A
**Estimated Hours**: 3.5
**Dependencies**: Stream A

## Coordination Points
### Shared Files
None with #12 or #15. The footer link to `/family` already exists from #11.
### Sequential Requirements
A → B, worked in order by one implementation chat.

## Conflict Risk Assessment
Low. The three parallel tasks touch separate files, as the epic planned.

## Parallelization Strategy
One implementation chat per task; streams within the task are sequential.

## Expected Timeline
- 5h for this task, alongside the other parallel tasks
