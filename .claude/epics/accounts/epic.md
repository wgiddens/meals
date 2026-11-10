---
name: accounts
status: in-progress
created: 2026-11-10T18:13:54Z
updated: 2026-11-10T19:19:03Z
progress: 0%
prd: .claude/prds/accounts.md
github: https://github.com/wgiddens/meals/issues/8
---

# Epic: accounts

## Overview

Replace the shared household passcode with personal accounts in one
invite-only family. Sign-in is Google or a passkey; an owner invites and
removes members. The work lands on the prototype codebase: the passcode gate
(`src/lib/household.ts`, `src/proxy.ts`, `src/app/auth-actions.ts`,
`src/app/login/`) is swapped for an account session, and every place that
calls `requireHousehold()` calls a member check instead. The prototype's
pages stay as they are; the `core` epic replaces them later.

## Architecture Decisions

### Sign-in library: Better Auth
`better-auth` 1.7.x with `@better-auth/passkey`.

- It covers everything the PRD asks for from one library: Google sign-in,
  passkeys, database sessions, and a magic-link plugin that the `email` PRD
  can switch on later without a rewrite.
- It stores its data in our own Postgres through a Drizzle adapter, so
  there is no extra service and no cost.
- Its published peer ranges include `next ^16`, `drizzle-orm ^0.45.2` and
  `drizzle-kit >=0.31.4`, which match this repo (checked on npm,
  2026-11-10).
- Rejected: Auth.js / NextAuth, whose v5 is still published as beta; a
  hosted auth service, which adds a dependency and breaks zero-setup local
  development; hand-rolled sessions, which the PRD rules out.

### Invite-only is enforced where accounts are created
Better Auth creates a user row on first Google sign-in. A database hook
that runs before user creation refuses the sign-in unless the verified
email is the configured owner email or has a pending invitation. This is
the single choke point, so no sign-in route can bypass it. Email and
password sign-in is switched off. The owner email is accepted only while
no owner exists, so there is always exactly one owner.

### Sessions live in the database, with no cookie cache
Sessions are rows, 90 days long, renewed on use. The session is looked up
on each request rather than cached in the cookie, so removing a member
takes effect on their very next request, as the PRD requires. At family
scale the extra query is negligible.

### Two layers of gate, as today
- `src/proxy.ts` keeps its current shape: a cheap check for the session
  cookie, redirecting signed-out page requests to `/sign-in?next=…` and
  answering 401 to `/api/*`. Exempt: `/sign-in`, `/api/auth/*`, `/api/mcp`,
  `/.well-known/*`.
- Server code does the real check. `requireMember()` replaces
  `requireHousehold()` in every Server Action and API route, and
  `requireOwner()` guards family management. The proxy is a convenience;
  these functions are the security boundary.

### One family, modelled minimally
- Better Auth's `user` table gains a `role` column (`owner` | `member`), declared server-only so no
  client request can set it.
- A single-row `family` table holds the family name.
- An `invitations` table holds name, email (stored lower-case, unique among
  pending), invited-by, created time and state (`pending`, `accepted`,
  `cancelled`).
- No family id on any table, per the PRD.

### Local development and missing configuration
- Not production and no Google client configured: `currentMember()` returns
  a built-in dev owner, created on first use. `npm run dev` needs nothing.
- Production: the dev shortcut is unreachable. The check is on
  `NODE_ENV === "production"` first, before any configuration is read. If
  Google or the secret is missing in production, the sign-in page says the
  app is not configured and nothing is accessible (fail closed).

### The auth instance is created lazily
`getDb()` is async and awaits the incoming request under Cache Components.
Better Auth needs a database handle when it is configured, so the instance
is built on first use behind a `getAuth()` function, the same pattern as
`getDb()`. All session reads are request-time and sit inside `<Suspense>`.

## Technical Approach

### Frontend Components
- `src/app/sign-in/page.tsx` – "Continue with Google" and "Use a passkey";
  shows "This account hasn't been invited" and "not configured" states;
  honours a safe `next` path (reuse `safeReturnPath` from the old gate).
- `src/app/family/page.tsx` – members with role, pending invitations, and
  owner-only controls: invite (name, email), cancel, remove, rename family.
  After inviting, shows the app address to pass on.
- `src/app/account/page.tsx` – display name, passkeys (add, remove), sign
  out.
- Small client components for the Google button, passkey button and
  passkey list, using Better Auth's React client.
- Layout footer: replace the passcode sign-out link with links to Family
  and My account.
- Removed: `src/app/login/`, `src/components/LoginForm.tsx`,
  `src/components/SignOutLink.tsx`.

### Backend Services
- `src/lib/auth.ts` – `getAuth()`: Better Auth configured with the Drizzle
  adapter, Google provider, passkey plugin, 90-day sessions, the invite-only
  creation hook and the after-creation hook (set role, mark the invitation
  accepted, create the family row for the owner).
- `src/app/api/auth/[...all]/route.ts` – Better Auth's request handler.
- `src/lib/member.ts` – `currentMember()`, `requireMember()`,
  `requireOwner()`; returns id, name, email, role. Holds the dev-owner
  shortcut and the production guard.
- `src/lib/family.ts` – the family rules as plain functions over the
  database, so they can be tested without a browser: `canSignUp(email)`,
  `inviteMember`, `cancelInvitation`, `removeMember` (deletes the user's
  sessions, passkeys and account), `renameFamily`, `listFamily`.
- `src/app/family/actions.ts`, `src/app/account/actions.ts` – Server
  Actions; each starts with `requireOwner()` or `requireMember()`.
- `src/app/actions.ts`, `src/app/api/plate/route.ts`,
  `src/app/api/import/route.ts` – swap `requireHousehold()` for
  `requireMember()`.
- `src/proxy.ts` – check for the Better Auth session cookie.
- Removed: `src/lib/household.ts`, `src/app/auth-actions.ts`.

### Infrastructure
- **Schema and migration:** add Better Auth's tables (`user`, `session`,
  `account`, `verification`, `passkey`) plus `family` and `invitations` to
  `src/db/schema.ts`. Each task that changes the schema generates its own
  Drizzle migration for its changes (task 1 added `drizzle/0001_accounts.sql`;
  later tasks add the next numbered file). A migration that has been merged
  is never edited or regenerated, since it may already be applied to a
  database. Prototype tables are untouched.
- **Environment variables:** add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`. Remove
  `HOUSEHOLD_PASSCODE`.
- **Google Cloud:** an OAuth client with the production callback URL. This
  is a manual step for the repo owner.
- **CI:** no new secrets. Checks run with no Google configuration, using the
  embedded database.
- **Preview deployments:** Google sign-in and passkeys are tied to one site
  address, so they work on the production domain only. Previews show the
  "not configured" page unless given their own configuration.

## Implementation Strategy

1. **Prove the library fits first.** Task 1 wires Better Auth to both
   database drivers (PGlite and postgres-js) under Cache Components before
   anything is built on it. If it does not fit, stop and revisit the
   library choice rather than work around it.
2. **Rules before pages.** The family rules and member checks are plain
   functions with automated checks; pages are thin over them.
3. **Swap the gate in one step.** The passcode gate is removed in the same
   task that introduces `requireMember()`, so the app is never ungated and
   never double-gated.
4. **Testing.** The repo has no test runner; it uses `tsx` scripts
   (`scripts/smoke.ts`). Add `scripts/check-accounts.ts` in the same style,
   run against a temporary embedded database, and include it in
   `npm run smoke` so CI runs it. Sign-in with Google and passkeys is
   checked by hand on the deployed app.
5. **Follow `AGENTS.md`.** Each task reads the relevant guide in
   `node_modules/next/dist/docs/` (proxy, Server Actions, Cache Components)
   before writing code.

Risks:
- Better Auth's Drizzle adapter against PGlite is unverified. Task 1
  settles it.
- The exact hook and plugin APIs should be read from the installed
  package's docs and types, not from memory.
- Passkeys break if the production domain changes (accepted in the PRD).

## Task Breakdown Preview

| # | Task | Depends on | Parallel |
|---|---|---|---|
| 1 | Sign-in foundation: install Better Auth, `getAuth()`, schema and migration, `/api/auth` route, env vars; verify on PGlite and Postgres | – | no |
| 2 | Family rules: `family` and `invitations` tables, `role`, invite-only creation hook, owner bootstrap, `src/lib/family.ts` | 1 | no |
| 3 | Member gate: `src/lib/member.ts`, new `proxy.ts` check, replace every `requireHousehold()`, dev owner, production fail-closed; delete the passcode code | 2 | no |
| 4 | Sign-in page with Google, sign out, and the My account page (display name) | 3 | yes, with 6 and 7 |
| 5 | Passkeys: plugin, add and remove on My account, passkey button on sign-in; adds its assertion to the check script | 4, 7 | yes, with 6 |
| 6 | Family page: members, invitations, owner controls | 3 | yes, with 4, 5 and 7 |
| 7 | Automated checks: `scripts/check-accounts.ts` in `npm run smoke` | 3 | yes, with 4 and 6 |
| 8 | Documentation and deployment: README, `.env.example`, `docs/ARCHITECTURE.md`, Google OAuth client and Vercel variables checklist, hand check on production | 4, 5, 6, 7 | no |

Tasks 4 and 5 both edit the sign-in and account pages, so they run in
sequence. Task 5 also waits for task 7, because it adds one assertion to
the check script. Task 6 touches separate files and can run alongside all
of them; task 3 adds both footer links so that 4 and 6 never share a file.

## Dependencies

- A Google Cloud project with an OAuth client (free). Needed for task 8's
  hand check, not for building.
- The owner's email, set as `OWNER_EMAIL` on Vercel.
- The existing Vercel project and Neon database.
- npm packages: `better-auth`, `@better-auth/passkey`.
- No other epic. `core` and `email` depend on this one.

## Success Criteria (Technical)

- `npm run typecheck`, `npm run lint`, `npm run smoke` and `npm run build`
  pass in CI with no sign-in secrets.
- `scripts/check-accounts.ts` proves, against a temporary database:
  - an email that is neither the owner nor invited cannot create a user;
  - the owner email creates the family and gets role `owner`;
  - an invited email becomes a `member` and its invitation is `accepted`;
  - removing a member deletes their sessions and passkeys, and the next
    session lookup fails;
  - `inviteMember`, `cancelInvitation`, `removeMember` and `renameFamily`
    refuse a non-owner;
  - the owner cannot be removed, and a second owner can never be created;
  - `role` cannot be changed through the sign-in library's client API;
  - the dev-owner shortcut is refused when `NODE_ENV` is `production`.
- Every Server Action and every `/api/*` route except `/api/auth` and
  `/api/mcp` calls `requireMember()` or `requireOwner()`.
- In production `/api/mcp` refuses every request when `MCP_API_KEY` is
  unset.
- `grep -ri "HOUSEHOLD_PASSCODE\|requireHousehold" .` finds nothing outside
  git history and `.claude/`.
- On production: Will signs in with Google as owner, invites Shannon, she
  signs in with Google, each adds a passkey and signs in with it, and a
  third Google account is refused.
- `npm run dev` on a fresh clone opens the app signed in as the dev owner
  with no environment variables.

## Estimated Effort

Eight tasks. Sizes: tasks 1, 2 and 3 are medium; 4, 5 and 6 are small to
medium; 7 and 8 are small. The critical path is 1 → 2 → 3 → 4 → 5 → 8;
tasks 6 and 7 run beside 4. The one step that needs the repo owner is
creating the Google OAuth client and setting the Vercel variables.

## Tasks Created
- [ ] #9 - Sign-in foundation with Better Auth (parallel: false)
- [ ] #10 - Family rules: invitations, roles and invite-only sign-up (parallel: false)
- [ ] #11 - Member gate: replace the household passcode (parallel: false)
- [ ] #12 - Sign-in page with Google, sign out and My account (parallel: true)
- [ ] #13 - Passkeys: add, remove and sign in (parallel: true)
- [ ] #14 - Family page: members, invitations and owner controls (parallel: true)
- [ ] #15 - Automated checks for the account rules (parallel: true)
- [ ] #16 - Documentation, deployment setup and production check (parallel: false)

Total tasks: 8
Parallel tasks: 4
Sequential tasks: 4
Estimated total effort: 38 hours
