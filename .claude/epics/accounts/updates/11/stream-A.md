---
issue: 11
stream: Member module, call sites, proxy and deletions (A-D, sequential)
started: 2026-11-10T20:59:18Z
status: completed
---
## Scope
Streams A-D from `11-analysis.md`, done in order by one implementer.
## Progress
- A: `src/lib/member.ts` (`currentMember`, `memberForRequest`,
  `requireMember`, `requireOwner`, `ensureDevOwner`) and `src/lib/gate.ts`
  (`gateMode`, `devOwnerAllowed`, `safeReturnPath`; pure functions of the
  environment).
- B: every Server Action calls `requireMember()`; `/api/plate` and
  `/api/import` answer 401 without a member.
- C: `proxy.ts` looks the session up (Will's option C); `/api/mcp` refuses
  in production with no `MCP_API_KEY`; the footer links to `/family` and
  `/account`; placeholder `/sign-in` with a not-configured state.
- D: passcode files deleted; the spec's grep finds nothing.
- Checks and hand checks: see progress.md.
