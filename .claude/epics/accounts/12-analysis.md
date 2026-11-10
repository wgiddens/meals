---
issue: 12
title: "Sign-in page with Google, sign out and My account"
analyzed: 2026-11-10T21:41:08Z
estimated_hours: 5
parallelization_factor: 1.0
---

# Parallel Work Analysis: Issue #12

## Overview
Real `/sign-in` page (replacing #11's placeholder) with a Google button, an `/account` page with display name and sign out, and Better Auth's `oAuthProxy` so Google sign-in works on Vercel previews (added by the stakeholder's decision).

Runs in parallel with the other tasks the stakeholder started together after
#11 (#12, #14, #15), each in its own implementation chat and PR.

## Parallel Streams

### Stream A: Auth client and preview proxy
**Scope**: `src/lib/auth-client.ts`, `oAuthProxy` plugin and narrow trusted origins in `src/lib/auth.ts`, new variable in `.env.example`
**Files**: `src/lib/auth-client.ts`, `src/lib/auth.ts`, `.env.example`
**Can Start**: immediately
**Estimated Hours**: 1.5
**Dependencies**: none

### Stream B: Sign-in page
**Scope**: Google button component, not-invited and not-configured states, signed-in redirect, passkey slot
**Files**: `src/app/sign-in/page.tsx`, `src/components/GoogleSignInButton.tsx`
**Can Start**: after Stream A
**Estimated Hours**: 1.5
**Dependencies**: Stream A

### Stream C: My account
**Scope**: Name, email, role; display-name Server Action (`requireMember()` first, 1-80 chars); sign out; passkey section
**Files**: `src/app/account/page.tsx`, `src/app/account/actions.ts`
**Can Start**: after Stream A
**Estimated Hours**: 2
**Dependencies**: Stream A

## Coordination Points
### Shared Files
`src/lib/auth.ts` is also read by #15's checks; #12 is the only open task that edits it. `.env.example` is edited only here (and later by #16).
### Sequential Requirements
A → B → C, worked in order by one implementation chat.

## Conflict Risk Assessment
Low. The three parallel tasks touch separate files, as the epic planned.

## Parallelization Strategy
One implementation chat per task; streams within the task are sequential.

## Expected Timeline
- 5h for this task, alongside the other parallel tasks
