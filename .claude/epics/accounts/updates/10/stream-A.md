---
issue: 10
stream: Schema, rules, hooks and carried-over checks (A-D, sequential)
started: 2026-11-10T20:07:28Z
status: completed
---
## Scope
Streams A-D from `10-analysis.md`, done in order by one implementer.

## Progress
- **A, schema and migration:** `user.role` (`user_role` enum: `owner` |
  `member`, NOT NULL, database default `member` so existing rows migrate to
  the least-privileged role), with a partial unique index allowing at most
  one owner. A single-row `family` table (`id` 1 enforced by a check). An
  `invitations` table (name, email, invited_by → user ON DELETE CASCADE,
  state `pending`/`accepted`/`cancelled`, timestamps), with a check that the
  email is lower-case and a partial unique index on email where pending.
  Generated `drizzle/0002_family.sql`; `0001_accounts.sql` untouched.
- **B, family rules:** `src/lib/family.ts` exports `canSignUp`,
  `signUpRole`, `completeSignUp`, `inviteMember`, `cancelInvitation`,
  `removeMember`, `renameFamily`, `listFamily`, `FamilyError` (with a code
  and a message that can be shown to the user). No Next.js request APIs.
  Each function takes an optional database handle. The acting member's role
  is re-read from the database.
- **C, auth hooks:** `databaseHooks.user.create.before` throws
  `EMAIL_NOT_VERIFIED` or `NOT_INVITED` (a 403 `APIError`, so no row is
  written and the OAuth callback redirects with that code), and otherwise
  returns `{ data: { role } }`, so the role is written with the row. The
  `after` hook creates the family ("Our family") for the owner or accepts
  the member's invitation. `role` is declared in `user.additionalFields`
  with `input: false`. The Google warning was removed from `auth.ts` and
  `.env.example`.
- **D, carried-over checks:** `check-auth.ts` stubs `next/server`'s
  `connection()`, sets `NEXT_RUNTIME`, and asserts one call for each
  `getAuth()`. The dead `childEnv.PGLITE_DATA_DIR` line is gone (the child
  now has it deleted from its environment and makes its own). Each process
  removes its temporary directory on exit.

- **Review fixes:**
  - The `role` default fixes OAuth sign-up.
  - Sign-up is checked through `handleOAuthUserInfo`.
  - `removeMember` cancels pending invitations, and stale invitations grant
    nothing.
  - An invitation cancelled mid-sign-in deletes the new user and refuses
    the sign-in.
  - See `progress.md`.

## Verified
- `check:auth` (72 assertions on PGlite, 73 on Postgres) passes on PGlite, and twice in a row against
  a local Postgres 16 through postgres-js (`CHECK_AUTH_DATABASE_URL`). The
  run cleans up its own rows.
- Mutation checks: removing `input: false`, the verified-email check, the
  invite check, the "no owner yet" condition or the owner-only check, or
  caching `getAuth()` before `getDb()`, each makes an assertion fail.
  Dropping the explicit `account` delete in `removeMember` does not, because
  the cascade removes those rows anyway.
- `0002` applied on top of `0001` with an existing user row: the row becomes
  `member`.
- typecheck, lint, smoke and build pass with no sign-in variables.
