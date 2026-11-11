---
issue: 13
title: "Passkeys: add, remove and sign in"
analyzed: 2026-11-11T02:39:38Z
estimated_hours: 5
parallelization_factor: 1.0
---

# Parallel Work Analysis: Issue #13

## Overview
Enable `@better-auth/passkey` (installed in #9) so a signed-in member can add,
list and remove passkeys on `/account` and sign in with one on `/sign-in`.
#12 left marked slots on both pages. Passkeys must never create an account,
and `removeMember` must remove them (the cascade from #10 should already do
this; prove it in `check-accounts.ts`).

Watch the relying-party settings: the spec derives them from
`BETTER_AUTH_URL`, but since #12 a preview's `BETTER_AUTH_URL` is the fixed
proxy preview's URL, not the preview's own host. A passkey's rpID must match
the site the browser is on, so previews need care (ask the orchestrator if
the spec and this conflict). Production and local development are
straightforward.

## Parallel Streams

### Stream A: Server plugin, schema and migration
**Scope**: enable the plugin in `getAuth()` with rpID/origin rules; add the `passkey` table to the schema; generate migration `0003_*` (never edit merged ones)
**Files**: `src/lib/auth.ts`, `src/db/schema.ts`, `drizzle/*`
**Can Start**: immediately
**Estimated Hours**: 1.5
**Dependencies**: none

### Stream B: Client and UI
**Scope**: passkey client plugin; `/account` list, add and remove; `/sign-in` "Use a passkey"; hide controls without browser support
**Files**: `src/lib/auth-client.ts`, `src/app/account/page.tsx`, `src/app/sign-in/page.tsx`, `src/components/Passkey*.tsx`
**Can Start**: after Stream A
**Estimated Hours**: 2.5
**Dependencies**: Stream A

### Stream C: Checks
**Scope**: `check-accounts.ts` assertion that removing a member deletes their passkeys and the passkey no longer signs in; a passkey can't create an account
**Files**: `scripts/check-accounts.ts`
**Can Start**: after Stream A
**Estimated Hours**: 1
**Dependencies**: Stream A

## Coordination Points
### Shared Files
None with other open tasks; #16 starts after this.
### Sequential Requirements
A → B → C, one implementation chat.

## Conflict Risk Assessment
Low.

## Parallelization Strategy
Sequential, one implementation chat.

## Expected Timeline
- 5h
