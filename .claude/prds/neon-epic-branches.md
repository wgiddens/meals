---
name: neon-epic-branches
description: Each epic gets its own Neon database branch, created when the epic starts and removed when it merges
status: backlog
created: 2026-11-11T03:30:00Z
---

# PRD: neon-epic-branches

> **Draft stub.** Split out of `neon-dev-database` as part of the MVP cut
> (stakeholder's decision, 2026-11-11). Needs a brainstorm before it becomes
> an epic; it shares that PRD's open questions about Neon's free-plan branch
> limit and how cloud agent sessions get a Neon API key safely.

## Executive Summary

As a developer or agent starting an epic, the epic gets its own Neon
database branch, removed when the epic merges.

## User Stories

### 1. A branch per epic
Acceptance criteria:
- Starting an epic creates its branch; merging the epic deletes it.
- No connection string is committed or printed.

## Success Criteria

- Zero branches left behind after an epic merges.
- CI remains green with no Neon secrets.

## Constraints & Assumptions

- The CCPM skill ships `references/scripts/neon-branch.sh`, which creates a
  branch `epic/<name>` for an epic's worktree and removes it on merge.
- Neon's free-plan branch limit has not been checked and may cap how many
  epics can hold a branch at once.

## Dependencies

- `neon-dev-database`, complete.
- A Neon API key and the project id.
