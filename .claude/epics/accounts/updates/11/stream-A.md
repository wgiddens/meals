---
issue: 11
stream: Member module, call sites, proxy and deletions (A-D, sequential)
started: 2026-11-10T20:59:18Z
status: in_progress
---
## Scope
Streams A-D from `11-analysis.md`, done in order by one implementer.
## Progress
- A: `src/lib/member.ts` (`currentMember`, `requireMember`, `requireOwner`,
  `ensureDevOwner`) and `src/lib/gate.ts` (`gateMode`, `devOwnerAllowed`,
  `safeReturnPath`; pure, so the proxy doesn't bundle the database).
- B: every Server Action calls `requireMember()`; `/api/plate` and
  `/api/import` answer 401 without a member.
- C: `proxy.ts` checks the Better Auth session cookie; `/api/mcp` refuses in
  production with no `MCP_API_KEY`; footer links to `/family` and
  `/account`; placeholder `/sign-in` with a not-configured state.
- D: passcode files deleted; the spec's grep finds nothing.
- All four streams are in one commit, so no commit is ungated or
  double-gated.
- typecheck, lint, smoke (gate decisions and dev owner checks added to
  `scripts/smoke.ts`) and `env -u DATABASE_URL npm run build` pass.
- Hand checks on `next dev` and `next start` are done (see progress.md).
- Open: pages accept any cookie value (asked the orchestrator; see
  progress.md).
