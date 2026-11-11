---
name: email-invite-status
description: Invitations expire, can be re-sent, and show the owner when the email couldn't be sent
status: backlog
created: 2026-11-11T03:30:00Z
---

# PRD: email-invite-status

## Executive Summary

Small additions to invitations once email exists: invitations expire, the
owner can re-send one, and the family page shows when an invitation email
couldn't be sent.

Split out of `email` as part of the MVP cut (stakeholder's decision,
2026-11-11).

## User Stories

### 1. Re-send and expiry
As the owner, I can re-send an invitation and see which have expired.

Acceptance criteria:
- Invitations gain an expiry (7 days) and an "expired" state.
- Expired invitations are shown as expired on the family page, with re-send
  and cancel available.
- The owner can re-send a pending invitation. Once `email-sign-in` exists,
  re-sending issues a new link and cancels the old one.

### 2. I know if an email didn't go
As the owner, I'm told when an invitation could not be sent.

Acceptance criteria:
- If the sending service rejects or fails an invitation, the family page
  shows "Couldn't send" on that invitation with a re-send control. The
  invitation itself is still recorded.

## Non-Functional Requirements

- **Tests:** automated tests cover expiry, re-send, and a failed send being
  shown. Tests never send real email.

## Dependencies

- `email`, complete. Link replacement on re-send needs `email-sign-in`.
