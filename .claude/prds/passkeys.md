---
name: passkeys
description: Let a signed-in family member add a passkey (Face ID, fingerprint) and sign in with it instead of Google
status: backlog
created: 2026-11-11T03:15:00Z
---

# PRD: passkeys

## Executive Summary

After `accounts`, every sign-in goes through Google. This PRD lets a member
who is already signed in add a passkey on their phone or laptop, then sign in
with Face ID or a fingerprint instead. Google stays available as the
fallback.

It was split out of `accounts` (stakeholder's decision, 2026-11-11) so that
accounts could ship as a smaller first release. The work was nearly finished
when it was split: draft PR wgiddens/meals#25 (branch
`claude/issue-13-passkeys`, reviewed, with review fixes in) is the starting
point, and the epic for this PRD should reuse it rather than start again.

## Problem Statement

Google sign-in works, but it takes a few taps and a Google account picker on
a shared family device. A passkey is quicker, needs no typing, and is tied to
the person's own device.

## User Stories

### 1. Add a passkey
As a signed-in family member, I add a passkey from My account.

Acceptance criteria:
- My account lists my passkeys with a name and the date added, and lets me
  add and remove them.
- Adding needs a recent sign-in (within the last day); otherwise I'm asked to
  sign out and sign in again.
- On a shared device, the system passkey picker shows each member by their
  own account, not by a device label.

### 2. Sign in with a passkey
As a family member, I tap "Use a passkey" on the sign-in page and I'm in.

Acceptance criteria:
- A registered passkey signs the member in without Google.
- Cancelling the prompt shows a neutral "cancelled" message, not an error.
- A member with a lost device can always still sign in with Google.

### 3. Removing a member removes their passkeys
Acceptance criteria:
- When the owner removes a member, that member's passkeys are deleted and no
  longer sign anyone in.

## Functional Requirements

- Passkeys are an addition to an existing account, never a way to create
  one.
- Browsers without passkey support don't show "Add" or "Use a passkey".
  "Remove" stays visible, so a lost device's passkey can be removed from any
  browser (stakeholder's decision on PR #25).
- Relying party:
  - production uses the host of `BETTER_AUTH_URL`, and passkeys are off if it
    is unset;
  - local development uses `localhost`;
  - each Vercel branch preview has its own passkeys: the rpID is the host of
    `VERCEL_BRANCH_URL` and the origin is exactly that URL; passkey controls
    show only where the page's hostname equals the rpID (stakeholder's
    decision, 2026-11-11).
- Open question from PR #25's review: whether to require discoverable
  credentials and user verification (Face ID, fingerprint or PIN). It only
  changes behaviour for hardware security keys; the recommendation is to
  require both. Decide before this PRD's epic is built.

## Non-Functional Requirements

- **Cost:** $0. Passkeys are free.
- **Don't hand-roll security:** use Better Auth's `@better-auth/passkey`
  plugin, matching the `accounts` sign-in library.
- **Tests:** automated checks cover a passkey never creating an account,
  removal deleting passkeys, the relying-party rules above, and wrong origins
  being refused.

## Success Criteria

- Will and Shannon each add a passkey on their own phone and sign in with it
  in production.
- A returning member signs in with a passkey in under 5 seconds.
- A removed member's passkey no longer signs in, verified by an automated
  test.

## Constraints & Assumptions

- **Passkeys need a stable site address.** A passkey is tied to the domain it
  was created on, so changing the app's domain later invalidates existing
  passkeys; members fall back to Google.
- Builds on the `accounts` sign-in library, pages and check script.

## Out of Scope

- Passkey-first sign-up (creating an account with a passkey).
- Passwords or text-message codes.

## Dependencies

- `accounts`, merged to `main`.
- `BETTER_AUTH_URL` set on production.
