---
name: accounts
description: Personal accounts for one family, invite only, with Google, email-link and passkey sign-in and an owner who manages members; replaces the shared household passcode
status: backlog
created: 2026-11-10T16:56:42Z
---

# PRD: accounts

## Executive Summary

Each person in the family gets their own account. There is one family, it is
invite only, and its owner decides who is in it. People sign in with Google,
with a link sent to their email, or with a passkey (Face ID or fingerprint)
once they have set one up. There are no passwords.

This replaces the prototype's shared household passcode, which is removed.
It is the first thing built: `core` and every later PRD rely on it to know
who is signed in.

## Problem Statement

A shared passcode treats the household as one anonymous user. That falls
short in three ways:

- **The product needs to know who did something.** The roadmap says
  "Shannon's approval locks the plan". A passcode cannot tell Shannon's phone
  from Will's.
- **Access cannot be managed.** Letting someone in means telling them the
  passcode; taking access away means changing it and signing every device
  out.
- **It is a dead end.** Texts to each person, per-person approval and
  assistant sign-in all need a person to attach to.

There are no real users yet, so the passcode can be dropped rather than
migrated.

## User Stories

### 1. The owner sets up the family
As Will, I become the family's owner the first time I sign in.

Acceptance criteria:
- The deployment names one owner email in configuration. The first
  successful sign-in with that email creates the family and makes that
  account the owner.
- Until then, no one else can sign in.
- No one can create an account or a family by any other route.

### 2. Sign in with Google
As a family member, I tap "Continue with Google" and I'm in.

Acceptance criteria:
- Sign-in succeeds only when the Google account's verified email matches
  the owner email or a current invitation or member.
- Any other Google account sees "This account hasn't been invited" and no
  account is created.

### 3. Sign in with an email link
As a family member, I type my email and tap the link that arrives.

Acceptance criteria:
- The link works once and expires after 15 minutes.
- The page always answers "If that address is invited, a link is on its
  way", whether or not it is, so it never reveals who is a member.
- No email is sent to an address that is not the owner, a member or
  invited.
- Requests are limited to 5 per address per hour.

### 4. Sign in with a passkey
As a family member, after my first sign-in I use Face ID or my fingerprint
instead.

Acceptance criteria:
- A signed-in member can add a passkey to their account from their account
  page, and can remove it.
- The sign-in page offers passkey sign-in; a registered passkey signs the
  member in without Google or email.
- A member with a lost device can always still sign in with Google or an
  email link.

### 5. Invite a family member
As the owner, I add Shannon by typing her name and email.

Acceptance criteria:
- The owner enters a name and an email on the family page; an invitation
  email with a sign-in link is sent.
- An invitation expires after 7 days, can be re-sent, and can be cancelled.
- The invited person becomes a member the first time they sign in by any
  method with that email.
- Pending invitations are listed on the family page.

### 6. Manage the family
As the owner, I see who is in the family and can remove someone.

Acceptance criteria:
- The family page lists each member's name, email and role (owner or
  member).
- The owner can remove a member. That member's sessions end immediately
  and they can no longer sign in.
- The owner cannot be removed and cannot remove themselves.
- A member can see the family page but has no invite, cancel or remove
  controls, and the server refuses those actions from a member.

### 7. Stay signed in, and sign out
As a family member, I sign in once on my phone and it stays that way.

Acceptance criteria:
- A session on a device lasts 90 days and renews on use.
- Sign out ends the session on that device.
- A member can change their own display name.

### 8. Everything is behind sign-in
As the family, nobody outside it can see or change anything.

Acceptance criteria:
- Every page except sign-in redirects a signed-out visitor to sign-in, then
  back to where they were going.
- Every server write checks for a signed-in member itself rather than
  relying on the redirect.
- Server code can ask "who is signed in?" and get the member's id, name and
  role, for later PRDs to use.

## Functional Requirements

### People and the family
- One family per deployment. It has a name and exactly one owner.
- A member has: name, email (unique, case-insensitive), role (`owner` or
  `member`), and the date they joined.
- An invitation has: name, email, who invited them, sent and expiry times,
  and a state (pending, accepted, cancelled, expired).
- Identity is the verified email. A person who signs in with Google and
  later with an email link, using the same address, is the same member.

### Sign-in methods
- Google, email link and passkey, as in stories 2 to 4. No passwords and no
  text-message codes.
- Passkeys are an addition to an existing account, never a way to create
  one.

### Roles
- **Owner:** invite, re-send, cancel, remove members; rename the family.
- **Member:** everything else in the app, equally with the owner.
- Meal, allergy and plan features do not differ by role.

### Pages
- Sign-in.
- Family: members, pending invitations, and the owner's controls.
- My account: display name, passkeys, sign out.

### Replacing the passcode
- The passcode gate, its login page, `HOUSEHOLD_PASSCODE` and their
  documentation are removed.
- The request-interception check that redirects signed-out visitors is kept
  in spirit but checks for an account session.

### Local development
- With no sign-in configuration, `npm run dev` signs the developer in
  automatically as a built-in owner so the app needs no setup.
- That shortcut is impossible on a production build: it must be refused
  when running in production regardless of configuration.

## Non-Functional Requirements

- **Cost:** $0 per month at family scale. Google sign-in and passkeys are
  free; email is sent through a provider's free tier.
- **Don't hand-roll security.** Sessions, Google sign-in, one-time links
  and passkeys come from an established, maintained library that stores its
  data in the app's own Postgres. The epic chooses it.
- **Session safety:** cookies are HttpOnly, Secure in production and
  SameSite=Lax; one-time links are stored hashed and are single use.
- **Privacy:** the only personal data stored is name and email. Emails are
  never shown to anyone outside the family.
- **Mobile first:** sign-in works one-handed at 375 px; with a passkey or
  Google it takes no typing.
- **Tests:** automated tests cover an uninvited email being refused by each
  method, an expired or reused link being refused, a removed member losing
  access, and a member being refused owner actions.
- **Quality gates:** typecheck, lint, smoke check and build green in CI,
  with no sign-in secrets needed in CI.

## Success Criteria

- Will and Shannon each sign in on their own phone with their own account.
- A returning member with a passkey or Google reaches the app in under 10
  seconds with no typing.
- 100% of sign-in attempts from an email that is not the owner, a member or
  invited are refused and create no account, verified by automated tests
  for all three methods.
- A removed member's next request is refused, verified by an automated test.
- Inviting a member takes the owner under 30 seconds.
- No reference to `HOUSEHOLD_PASSCODE` remains in code or documentation.
- Monthly cost is $0.

## Constraints & Assumptions

- **Stack is fixed:** Next.js 16, Drizzle, PGlite locally, Vercel with Neon.
  Follow `AGENTS.md` and read the bundled Next.js docs first.
- **Built first, before `core`.** The accounts epic lands on the prototype
  codebase and replaces its passcode gate; `core` then replaces the pages
  behind it.
- **One family only.** Family data is not tagged with a family id. Opening
  the app to other families later would require adding one throughout; that
  cost is accepted for now.
- **Email needs a sending address.** Most free email services will only
  send to arbitrary recipients from a domain you have verified. If no
  domain is available, the email-link method and invitation emails are
  limited, and the owner can instead tell the person to use Google once
  invited. To be settled when the epic is written.
- **Google sign-in needs a Google Cloud project** with an OAuth client,
  which is free.
- **Passkeys need a stable site address.** A passkey is tied to the domain
  it was created on, so changing the app's domain later invalidates
  existing passkeys; members fall back to Google or email.
- Children do not get accounts in this version.

## Out of Scope

- Multiple families, open sign-up, or creating a second family.
- Passwords, text-message codes, and two-step verification beyond what
  Google and passkeys already give.
- Child or view-only accounts, and any per-role limits on meals, allergies
  or plans.
- Transferring ownership to another member; done by changing the owner
  email in configuration if ever needed.
- Phone numbers and notification preferences (`phone-approval`).
- Assistant sign-in. MCP keeps its bearer token until `mcp-oauth`, which
  can then sign assistants in as a member.
- Recording which member added or changed a meal.
- Account deletion and data export beyond the owner removing a member.

## Dependencies

- `docs/PRODUCT.md` – it wins on conflict. Its "Not now" entry on accounts
  is updated alongside this PRD.
- A Google Cloud OAuth client (client id and secret on the deployment).
- An email-sending service on a free tier, and ideally a verified domain.
- The owner's email in deployment configuration.
- A session secret on the deployment.
- Nothing upstream: this is the first PRD built. `core` depends on it.
