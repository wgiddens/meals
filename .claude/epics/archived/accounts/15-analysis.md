---
issue: 15
title: "Automated checks for the account rules"
analyzed: 2026-11-10T21:41:08Z
estimated_hours: 3
parallelization_factor: 1.0
---

# Parallel Work Analysis: Issue #15

## Overview
`scripts/check-accounts.ts`, run by `npm run smoke` and `npm run check:accounts`, proves the account rules against a temporary database. `scripts/check-auth.ts` already proves several of them (from #10 and #11); avoid duplicating assertions, and note in the PR which file covers each criterion.

Runs in parallel with the other tasks the stakeholder started together after
#11 (#12, #14, #15), each in its own implementation chat and PR.

## Parallel Streams

### Stream A: Account rule checks
**Scope**: `scripts/check-accounts.ts` covering every acceptance criterion through the real code paths (Better Auth server API or the hook functions), plus `package.json` scripts
**Files**: `scripts/check-accounts.ts`, `package.json`
**Can Start**: immediately
**Estimated Hours**: 3
**Dependencies**: none

## Coordination Points
### Shared Files
`package.json` is edited only here among the parallel tasks. `scripts/smoke.ts` may need one line to run the new script; no other parallel task edits it.
### Sequential Requirements
A, worked in order by one implementation chat.

## Conflict Risk Assessment
Low. The three parallel tasks touch separate files, as the epic planned.

## Parallelization Strategy
One implementation chat per task; streams within the task are sequential.

## Expected Timeline
- 3h for this task, alongside the other parallel tasks
