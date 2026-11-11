---
issue: 16
title: Documentation, deployment setup and production check
analyzed: 2026-11-11T03:10:19Z
estimated_hours: 3
parallelization_factor: 1.0
---

# Analysis: #16

## Overview
Documentation and cleanup only, plus removing the leftover passkey placeholder and the unused `@better-auth/passkey` dependency (passkeys moved to their own PRD). One sequential stream: the docs depend on knowing the final code state, and the cleanup is small.

## Parallel Streams

### Stream A: Docs, cleanup and checks
**Scope**: README, `.env.example`, `docs/ARCHITECTURE.md` (or `docs/DEPLOY.md`), `docs/PRODUCT.md`, the `src/db/index.ts` comment, the passkey placeholder and comments, and the dependency removal; then the setup checklist and the hand-check list.
**Files**:
- `README.md`, `.env.example`, `docs/ARCHITECTURE.md`, `docs/PRODUCT.md`, optionally `docs/DEPLOY.md`
- `src/db/index.ts` (comment only)
- `src/app/account/page.tsx`, `src/app/sign-in/page.tsx`, `src/lib/auth.ts` (passkey placeholder and comments)
- `package.json`, `package-lock.json`
**Can Start**: immediately
**Estimated Hours**: 3
**Dependencies**: none

## Coordination Points
None; single stream.

## Conflict Risk
Low. PR #25 (parked passkeys) also touches `package.json`, the account and sign-in pages; it will be rebased onto `main` later.
