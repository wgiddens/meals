---
name: email
description: Let the app send email from our own domain, and use it for an invitation email when the owner adds a family member
status: backlog
created: 2026-11-10T18:07:42Z
updated: 2026-11-11T03:30:00Z
---

# PRD: email

## Executive Summary

The app gains the ability to send email, through a third-party sending
service connected to Vercel, from an address on a domain we own. The first
use is an **invitation email** when the owner adds a family member, telling
them where the app is and to sign in with Google.

It also leaves behind one shared way to send a message, so later PRDs can
email the family without setting any of this up again.

This is the MVP cut (stakeholder's decision, 2026-11-11). Split out to their
own PRDs:
- `email-sign-in`: sign in by one-time email link, and invitation links that
  sign the person in, so a Google account is no longer required.
- `email-invite-status`: invitation expiry, re-send, and showing the owner
  when an invitation couldn't be sent.

Nothing depends on this PRD. It can be built any time after `accounts`.

## Problem Statement

After `accounts`, the app cannot send anything to anyone. Inviting someone is
a manual relay: the owner types an email into the family page and then has
to tell that person, some other way, where the app is and which Google
account to use.

Vercel does not send email itself; it points apps to a sending service.
That service, a domain to send from, and the rules for using them safely
have to be chosen and set up once.

## User Stories

### 1. The invitation arrives by email
As the owner, when I invite someone they get an email, and I don't have to
explain anything.

Acceptance criteria:
- Inviting a member (name and email) sends an email to that address within
  one minute.
- The email names the family and the person who invited them, gives the
  app's address as a button and as text, and says to sign in with Google
  using that email address.
- If sending fails, the invitation is still recorded and the family page
  still shows the app's address to pass on, as in `accounts`.

### 2. Email works without setup on my laptop
As a developer, I run the app locally and can still use invitations.

Acceptance criteria:
- With no sending service configured, emails are not sent. Their recipient,
  subject and body are printed to the server log instead.
- A production build with no sending service configured falls back to the
  `accounts` behaviour for invitations (record only, owner passes on the
  address), rather than failing.

### 3. Later features can send email easily
As a developer on a later PRD, I send the family a message with one call.

Acceptance criteria:
- One server-side function takes a recipient who must be a member or a
  pending invitation, a subject and a body, and sends it.
- That function is the only place in the code that talks to the sending
  service.
- It refuses any recipient who is not a member or pending invitation.

## Functional Requirements

- Email is sent through one third-party service installed from the Vercel
  Marketplace, so its key is managed in the Vercel project. The epic
  confirms the choice; Resend is the expected one.
- Mail is sent from a single address on a domain we own, for example
  `meals@<our-domain>`, with the domain's sending records (SPF, DKIM)
  verified with the service.
- Emails are plain and short: one purpose, one button, and the same link
  written out as text. Each has a plain-text version.
- Every send is recorded: recipient, kind (invitation), time, and whether
  the service accepted it. Message bodies are not stored.

## Non-Functional Requirements

- **Cost:** $0 per month on the sending service's free tier. Expected
  volume is under 50 emails a month; the app enforces a ceiling of 50 a day
  so a fault cannot run up usage.
- **Deliverability:** invitation emails reach the inbox, not spam, for
  Gmail, Outlook and iCloud addresses, checked by hand once at launch.
- **Security:** the sending key exists only in server-side configuration.
- **Privacy:** email addresses are sent to the sending service only as
  recipients. No address outside the family is ever emailed.
- **Tests:** automated tests cover an address outside the family being
  refused by the send function, the daily ceiling, and the no-service
  fallback. Tests never send real email.
- **Quality gates:** typecheck, lint, smoke check and build green in CI
  with no email secrets present.

## Success Criteria

- An invited person receives the invitation email within one minute.
- Invitation emails land in the inbox for Gmail, Outlook and iCloud test
  addresses.
- The code has exactly one module that calls the sending service.
- Monthly cost is $0.

## Constraints & Assumptions

- **The domain is `giddens.app`** (see `custom-domain`). Sending services
  verify a domain before sending to arbitrary addresses; its mail records
  are set up here, not in `custom-domain`.
- **Free-tier limits are assumed, not verified in full.** Resend's pricing
  page states a cap of 100 emails a day on its free plan; other details
  (monthly total, number of domains) come from third-party sources and
  must be checked on the official page when the epic is written.
- **Stack is fixed** as in `accounts`. Follow `AGENTS.md` and read the
  bundled Next.js docs first.
- **Every member still needs a Google account** until `email-sign-in`.
- **One family only**, as in `accounts`.

## Out of Scope

- Sign-in by email link, and invitation links that sign the person in
  (`email-sign-in`).
- Invitation expiry, re-send and "couldn't send" status
  (`email-invite-status`).
- Telling the family a weekly draft is ready, or any other notification.
  `phone-approval` decides whether that goes by text, email or both; this
  PRD only makes email possible.
- Receiving email, mailboxes, or replies. The sending address does not
  accept mail.
- Newsletters, digests, marketing email and unsubscribe management.
- Branded or heavily designed templates.
- Text messages.
- Changing a member's email address.
- Passwords and password reset.

## Dependencies

- **`accounts` PRD, complete:** members, invitations and the family page.
- A domain we own, with access to its DNS records. Vercel can manage the
  DNS but does not provide the sending.
- An email-sending service installed from the Vercel Marketplace, on its
  free tier.
- `docs/PRODUCT.md` – it wins on conflict.
