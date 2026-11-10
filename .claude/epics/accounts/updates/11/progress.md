---
issue: 11
started: 2026-11-10T20:59:18Z
last_sync: 2026-11-10T21:16:00Z
completion: 100%
---

# Issue #11: Member gate: replace the household passcode

Streams A-D in `11-analysis.md` are implemented on
`claude/issue-11-member-gate` (see `stream-A.md`). Will's decision on the
proxy (option C) is implemented. Draft PR #21 into `epic/accounts`; the
first review's three findings are fixed (see "Review fixes").

## Verified
- `npm run typecheck`, `npm run lint`, `npm run smoke` and
  `env -u DATABASE_URL npm run build` pass. Smoke runs 350 checks:
  check:import, check:auth and smoke.ts (348 after the re-check fix).
- `check:auth` also passes against a throwaway local Postgres 16
  (`CHECK_AUTH_DATABASE_URL`, 104 checks).
- `check:auth` calls `proxy()` directly with a `NextRequest`:
  - a member's cookie gets through;
  - no cookie, a forged signature, a made-up cookie and, after
    `removeMember`, the removed member's cookie are all redirected to
    `/sign-in?next=…` on pages and get 401 on `/api/*`;
  - `/sign-in`, `/api/auth/*`, `/api/mcp` and `/.well-known/*` stay
    reachable.
- `smoke.ts` checks:
  - `gateMode` and `devOwnerAllowed` across 10 environments, production
    included;
  - `safeReturnPath`, with `/sign-in` refused;
  - the dev owner is created on first use with the family row, reused
    (also under two calls at once), and an existing owner is used instead.
- Hand checks, all with throwaway databases and `curl`:
  - `next start` with a local Postgres 16 and sign-in configured:
    - a member's cookie gets 200 on `/plan`, on a prefetch of `/recipes`,
      and through the gate on `/api/import`;
    - a forged signature gets 307 to `/sign-in?next=…` on pages and
      prefetches, and 401 on `/api/import`;
    - after `removeMember`, that member's next request gets 307 or 401,
      while the owner's cookie still gets 200.
  - `next start`, nothing configured, or only `BETTER_AUTH_SECRET`: pages get
    307 to `/sign-in?next=…` even with a cookie, the APIs and `/api/mcp` get
    401, and `/sign-in` shows "Sign-in isn't set up yet".
  - `next start` with `MCP_API_KEY`: no token or a wrong one gets 401, the
    right one 200. With no key in production, every request gets 401.
  - `next dev`, no Google: every page 200, the APIs get past the gate, and
    `/api/mcp` with no key gets 200. `/sign-in?next=/plan` redirects to
    `/plan`. The database then holds `dev-owner` (role owner) and the family
    row.
  - `next dev` with Google, PGlite: the owner's cookie gets 200; a forged
    one gets 307.
  - Temporary logging showed that `getDb()` → `connection()` runs and
    resolves inside the proxy on `next start` (`NEXT_RUNTIME=nodejs`), so
    `getAuth()` needed no special path. The logging was removed.

## Decisions
- **The proxy does a full session lookup (Will chose option C).** The spec
  had a cookie-presence check. With that, any made-up cookie value let a
  visitor read every page, and a removed member's cookie kept working for
  pages. Now `proxy.ts` calls `memberForRequest(request.headers)`, which
  makes Better Auth look the session up in the database, so pages are
  protected by the proxy itself. `requireMember()` stays in actions and API
  routes as a second check. Requests with no session cookie are refused
  without a database query. Prefetches get the same check, because they
  carry page content.
- `gateMode(env)` returns `dev-owner`, `sign-in` or `closed`, checking
  `NODE_ENV === "production"` first. It lives in `src/lib/gate.ts` with
  `safeReturnPath`; `member.ts` re-exports both.
- If an owner already exists, the dev shortcut uses that owner instead of
  inserting a second one, which the single-owner index forbids.
- `/api/mcp` uses `required: true`, and its verifier returns no auth info in
  production when there is no key.
- `scripts/smoke.ts` and `scripts/check-auth.ts` changed, though they are
  not in the spec's file list: smoke imported the deleted `household.ts`,
  and the checks prove the criteria.

## Review fixes (first review of PR #21)
1. **Renewal reaches the browser.** `getSession()` renewed the session in
   the database about once a day, but dropped the `Set-Cookie`, so an
   active member's cookie still expired 90 days after sign-in. The proxy
   now calls `getSession({ headers, returnHeaders: true })` (through
   `lookUpMember`) and copies each `Set-Cookie` onto its response.
   - check-auth: a session backdated to 30 days goes through `proxy()`;
     the row is renewed to 90 days and the response carries the renewed
     cookie with `Max-Age=7776000`. A second request sets no cookie.
   - By hand on `next start` against Postgres 16: a session at 80 days
     gets `Set-Cookie: __Secure-better-auth.session_token=…;
     Max-Age=7776000; Secure; HttpOnly` and the row goes to 90 days. The
     next request sets nothing.
2. **The checks now catch each rule the review could remove unnoticed.**
   - Look-alike paths are not exempt: `/api/auth`, `/api/authx`,
     `/api/mcpx`, `/sign-inx`, `/sign-in/x`, `/.well-knownx`.
   - Closed mode refuses a valid cookie, both in the proxy and in
     `memberForRequest`.
   - `/api/mcp`'s check is now a pure `verifyMcpToken(token, env)` in
     `src/lib/mcp-auth.ts`; smoke checks that production with no key
     refuses every token.
   - smoke reads every `"use server"` file under `src` and fails if an
     exported action does not start with `requireMember()` or
     `requireOwner()`.
   - Each mutation from the review was applied by hand and now fails
     `npm run smoke`. The renewed-cookie copy removed also fails it.
     Removing the proxy's own `mode === "sign-in"` test does not, because
     `lookUpMember` returns null in closed mode too, so behaviour is
     unchanged.
3. **Stale comments** reworded in `gate.ts`, `actions.ts` and the import
   and plate routes.

## Re-check fix
- The re-check approved, with one minor finding: the Server Action scan in
  smoke could be fooled by `export const x = async () => {}`, a comment
  before `"use server"`, `export default`, or an inline `"use server"` in
  a page. The scan now fails closed:
  - it finds the directive after leading comments;
  - any export in an action file other than a guarded `export async
    function` (or a type) is a problem;
  - any `"use server"` that isn't the file's first statement is a
    problem.
- Fixture strings in smoke show each bypass is caught. Each was also
  applied to the real tree by hand and failed `npm run smoke`.

## Will's decisions on the held items
- `/api/auth/*` stays reachable in closed mode, as built.
- The dev shortcut reusing an existing owner is accepted as built. #16's
  docs will warn never to run a dev server against the production
  database.

## Open
- Nothing for this PR. `requireOwner()` gets an automated check when #14
  first calls it.
- `requireOwner()` has no automated check yet: it needs request headers,
  and nothing calls it until the family page (#14).

<!-- SYNCED: 2026-11-10T21:16:00Z -->
