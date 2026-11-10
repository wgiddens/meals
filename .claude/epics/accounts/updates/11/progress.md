---
issue: 11
started: 2026-11-10T20:59:18Z
last_sync: 2026-11-10T20:59:18Z
completion: 85%
---

# Issue #11: Member gate: replace the household passcode

Streams A-D in `11-analysis.md` are implemented in one commit on
`claude/issue-11-member-gate` (see `stream-A.md`).

## Verified
- `npm run typecheck`, `npm run lint`, `npm run smoke` (300 checks) and
  `env -u DATABASE_URL npm run build` pass.
- Hand checks used throwaway PGlite directories and `curl`.
  - `next start`, nothing configured: pages 307 to
    `/sign-in?next=<path>`, even with a session cookie. `/api/import`,
    `/api/plate` and `/api/mcp` answer 401. `/sign-in` shows "Sign-in isn't
    set up yet".
  - `next start`, only `BETTER_AUTH_SECRET` set: the same, closed.
  - `next start`, fully configured, signed out: pages 307, APIs 401.
    `/sign-in`, `/api/auth/ok` and `/.well-known/*` reach the app (200/404,
    not redirected).
  - `next start`, real Better Auth sessions (owner and member, signed
    cookies): pages 200 and the APIs get past the member check. A cookie
    with a bad signature still gets 401 from the APIs.
  - `next start` with `MCP_API_KEY`: no token or a wrong token gets 401; the
    right token gets 200. Without the key in production, every request
    gets 401.
  - `next dev`, no Google: every page 200, the APIs get past the member
    check, and `/api/mcp` with no key gets 200. `/sign-in?next=/plan`
    redirects to `/plan`. The database then holds `dev-owner` (role owner)
    and the family row.
  - `next dev` with Google: signed out, pages 307 and APIs 401.

## Decisions
- `gateMode(env)` returns `dev-owner`, `sign-in` or `closed`, checking
  `NODE_ENV === "production"` first. It lives in `src/lib/gate.ts` with
  `safeReturnPath`, so `proxy.ts` doesn't bundle Better Auth and the
  database. `member.ts` re-exports both.
- If an owner already exists, the dev shortcut uses that owner instead of
  inserting a second one, which the single-owner index forbids.
- `/api/mcp` uses `required: true`. The verifier returns no auth info in
  production when there is no key, so every request gets 401. Dev behaviour
  is unchanged.
- `scripts/smoke.ts` imported `safeReturnPath` from `household.ts`, so it
  was updated. It also gained the gate and dev owner checks.

## Open
- The proxy only checks that the cookie is present, and pages don't call
  `requireMember()`. Any cookie value therefore renders pages (reads only;
  actions and APIs refuse). Asked the orchestrator for a decision.
