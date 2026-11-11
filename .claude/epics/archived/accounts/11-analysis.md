---
issue: 11
title: "Member gate: replace the household passcode"
analyzed: 2026-11-10T20:59:18Z
estimated_hours: 5
parallelization_factor: 1.0
---

# Parallel Work Analysis: Issue #11

## Overview
Swap the passcode gate for an account session everywhere in one step, then
delete the passcode code. `requireHousehold()`/`isGateEnabled` are used in
`src/app/actions.ts`, `src/proxy.ts`, `src/app/api/mcp/route.ts`,
`src/app/auth-actions.ts`, `src/app/login/`, `src/components/` and
`src/lib/household.ts` (18 references). "household" in `src/lib/dates.ts`
(timezone) and in `/api/mcp`'s descriptions and token scopes is unrelated to
the passcode; leave that wording alone. The swap has to be atomic, so one
implementer works the streams in order and the app is never ungated or
double-gated at any commit that passes the checks.

## Parallel Streams

### Stream A: Member module
**Scope**: `src/lib/member.ts`: `currentMember()`, `requireMember()`,
`requireOwner()`, `devOwnerAllowed(env)` (pure), dev owner created on
first use (inserted directly, since #10's hook refuses it), production
guard first, `safeReturnPath` moved here with `/sign-in`.
**Files**: `src/lib/member.ts`
**Can Start**: immediately
**Estimated Hours**: 1.5
**Dependencies**: none

### Stream B: Call sites
**Scope**: `requireHousehold()` → `requireMember()` in Server Actions;
`/api/plate` and `/api/import` check `requireMember()` and answer 401.
**Files**: `src/app/actions.ts`, `src/app/api/plate/route.ts`, `src/app/api/import/route.ts`
**Can Start**: after Stream A
**Estimated Hours**: 1
**Dependencies**: Stream A

### Stream C: Proxy, MCP, layout, sign-in placeholder
**Scope**: `proxy.ts` checks the Better Auth session cookie, with the exempt
list from the spec; `/api/mcp` refuses in production with no key; footer
links to `/family` and `/account`; minimal `/sign-in` placeholder with a
not-configured state.
**Files**: `src/proxy.ts`, `src/app/api/mcp/route.ts`, `src/app/layout.tsx`, `src/app/sign-in/page.tsx`
**Can Start**: after Stream A
**Estimated Hours**: 1.5
**Dependencies**: Stream A

### Stream D: Delete the passcode
**Scope**: delete `household.ts`, `auth-actions.ts`, `login/`,
`LoginForm.tsx`, `SignOutLink.tsx`; the grep in the spec finds nothing.
**Files**: deletions listed above
**Can Start**: after Streams B and C
**Estimated Hours**: 1
**Dependencies**: Streams B, C

## Coordination Points
### Shared Files
- `src/app/layout.tsx` is edited only here, so #12 and #14 never touch it.
- `scripts/check-accounts.ts` belongs to #15; checks for `devOwnerAllowed`
  may go in `check-auth.ts` if needed to show a criterion.
### Sequential Requirements
A → (B, C) → D, all in one PR.

## Conflict Risk Assessment
Low. Single implementer. #12, #14 and #15 wait on this task.

## Parallelization Strategy
Sequential, one implementation chat.

## Expected Timeline
- With parallel execution: 4h wall time (B beside C)
- Without: 5h
- Efficiency gain: 20% (not used: single implementer)
