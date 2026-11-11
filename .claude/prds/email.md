---
name: email
description: Let the app send email from our own domain, then use it for invitation emails and email-link sign-in so family members no longer need a Google account
status: backlog
created: 2026-11-10T18:07:42Z
---

# PRD: email

## Executive Summary

The app gains the ability to send email, through a third-party sending
service connected to Vercel, from an address on a domain we own. Two
features use it straight away: an **invitation email** when the owner adds a
family member, and **sign-in by email link** as a third way in alongside
Google (and passkeys, once the `passkeys` PRD is built).

It also leaves behind one shared way to send a message, so later PRDs can
email the family without setting any of this up again.

Nothing depends on this PRD. It can be built any time after `accounts`.

## Problem Statement

After `accounts`, the app cannot send anything to anyone:

- **Inviting someone is a manual relay.** The owner types an email into the
  family page and then has to tell that person, some other way, where the
  app is and which Google account to use.
- **Everyone needs a Google account.** That is fine for Will and Shannon,
  but not for anyone who doesn't have one or would rather not use it.
- **There is no fallback way in.** A member whose Google account is
  unavailable and who has no passkey on the device in hand is locked out.

Vercel does not send email itself; it points apps to a sending service.
That service, a domain to send from, and the rules for using them safely
have to be chosen and set up once.

## User Stories

### 1. The invitation arrives by email
As the owner, when I invite someone they get an email with a link, and I
don't have to explain anything.

Acceptance criteria:
- Inviting a member (name and email) sends an email to that address within
  one minute.
- The email names the family and the person who invited them, and has one
  button that opens the app and signs them in.
- The invitation link works once and expires after 7 days.
- The owner can re-send a pending invitation, which issues a new link and
  cancels the old one.
- Expired invitations are shown as expired on the family page, with re-send
  and cancel available.
- The invited email no longer has to be a Google account.

### 2. Sign in with an email link
As a family member, I type my email and tap the link that arrives.

Acceptance criteria:
- The sign-in page offers "Email me a link" beside Google and passkey.
- The link works once and expires after 15 minutes.
- The page always answers "If that address is in the family, a link is on
  its way", whether or not it is, so it never reveals who is a member.
- No email is ever sent to an address that is not the owner, a member or a
  pending invitation.
- Requests are limited to 5 per address per hour and 20 per hour from one
  network address.
- A person who has signed in with Google and later uses a link with the
  same email is the same member, with the same passkeys and role.

### 3. I know if an email didn't go
As the owner, I'm told when an invitation could not be sent.

Acceptance criteria:
- If the sending service rejects or fails an invitation, the family page
  shows "Couldn't send" on that invitation with a re-send control. The
  invitation itself is still recorded.
- A failed sign-in link shows the same neutral message as success; the
  failure is logged, not shown.

### 4. Email works without setup on my laptop
As a developer, I run the app locally and can still use invitations and
sign-in links.

Acceptance criteria:
- With no sending service configured, emails are not sent. Their recipient,
  subject and link are printed to the server log instead.
- A production build with no sending service configured hides "Email me a
  link" and falls back to the `accounts` behaviour for invitations (record
  only, owner passes on the address), rather than failing.

### 5. Later features can send email easily
As a developer on a later PRD, I send the family a message with one call.

Acceptance criteria:
- One server-side function takes a recipient who must be a member or a
  pending invitation, a subject and a body, and sends it.
- That function is the only place in the code that talks to the sending
  service.
- It refuses any recipient who is not a member or pending invitation.

## Functional Requirements

### Sending
- Email is sent through one third-party service installed from the Vercel
  Marketplace, so its key is managed in the Vercel project. The epic
  confirms the choice; Resend is the expected one.
- Mail is sent from a single address on a domain we own, for example
  `meals@<our-domain>`, with the domain's sending records (SPF, DKIM)
  verified with the service.
- Emails are plain and short: one purpose, one button, and the same link
  written out as text. Each has a plain-text version.
- Every send is recorded: recipient, kind (invitation, sign-in link),
  time, and whether the service accepted it. Message bodies and links are
  not stored.

### One-time links
- Links carry a random token that is stored only as a hash, is single use,
  and expires (15 minutes for sign-in, 7 days for invitations).
- Opening a used or expired link shows a page offering to send a new
  sign-in link, never an error dump.
- Links are generated by the same sign-in library chosen in `accounts`.

### Changes to `accounts` behaviour
- Invitations gain an expiry, a re-send action and an "expired" state.
- An invitation can be accepted by Google sign-in with that email or by its
  email link, whichever comes first.
- Removing a member or cancelling an invitation invalidates any
  outstanding links for that address.

## Non-Functional Requirements

- **Cost:** $0 per month on the sending service's free tier. Expected
  volume is under 50 emails a month; the app enforces a ceiling of 50 a day
  so a fault cannot run up usage.
- **Deliverability:** invitation and sign-in emails reach the inbox, not
  spam, for Gmail, Outlook and iCloud addresses, checked by hand once at
  launch.
- **Speed:** an email is handed to the sending service within 5 seconds of
  the request.
- **Security:** tokens are hashed at rest and single use; the sending key
  exists only in server-side configuration; rate limits apply before any
  email is sent.
- **Privacy:** email addresses are sent to the sending service only as
  recipients. No address outside the family is ever emailed.
- **Tests:** automated tests cover a reused link, an expired link, an
  address outside the family receiving nothing, the rate limit, a removed
  member's link being refused, and the no-service fallback. Tests never
  send real email.
- **Quality gates:** typecheck, lint, smoke check and build green in CI
  with no email secrets present.

## Success Criteria

- An invited person with no Google account goes from invitation email to
  signed in, in under one minute and two taps.
- Invitation and sign-in emails land in the inbox for Gmail, Outlook and
  iCloud test addresses.
- 100% of link requests for addresses outside the family send no email,
  verified by an automated test.
- 100% of reused or expired links are refused, verified by automated tests.
- A failed invitation send is visible to the owner on the family page.
- The code has exactly one module that calls the sending service.
- Monthly cost is $0.

## Constraints & Assumptions

- **A domain we own is required and is not yet confirmed.** Sending
  services verify a domain before sending to arbitrary addresses. This PRD
  cannot start until a domain is chosen. A domain is the one likely cost
  here, typically paid yearly.
- **Free-tier limits are assumed, not verified in full.** Resend's pricing
  page states a cap of 100 emails a day on its free plan; other details
  (monthly total, number of domains) come from third-party sources and
  must be checked on the official page when the epic is written.
- **Stack is fixed** as in `accounts`. Follow `AGENTS.md` and read the
  bundled Next.js docs first.
- **Email is as secure as the inbox.** Anyone who can read a member's email
  can sign in as them. This is the normal trade-off for link sign-in and is
  accepted.
- **One family only**, as in `accounts`.

## Out of Scope

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

- **`accounts` PRD, complete:** members, invitations, sessions, the sign-in
  library and the family page.
- A domain we own, with access to its DNS records. Vercel can manage the
  DNS but does not provide the sending.
- An email-sending service installed from the Vercel Marketplace, on its
  free tier.
- `docs/PRODUCT.md` – it wins on conflict.
