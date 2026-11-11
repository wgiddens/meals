---
name: neon-dev-database
description: Develop against a Neon branch instead of the embedded database, for parity with production, while keeping the no-setup fallback
status: backlog
created: 2026-11-10T18:49:04Z
updated: 2026-11-11T03:30:00Z
---

# PRD: neon-dev-database

> **Draft stub.** This records an idea and what we know so far. It has not
> been through a brainstorm and must be fleshed out before it is parsed into
> an epic. The open questions at the end are the starting point.

## Executive Summary

Local development runs against a branch of the real Neon database rather
than the embedded one, so what we test behaves like production. The embedded database stays for CI and as the fallback when no
Neon access is configured.

MVP cut (stakeholder's decision, 2026-11-11): a database branch per epic is
split out to `neon-epic-branches`.

## Problem Statement

Production runs on Neon through Vercel. Local development runs on PGlite, an
embedded Postgres. PGlite is real Postgres but differs from production: one
connection, no pooling, and none of Neon's own behaviour. Problems that only
appear on Neon are found after deploying.

## What we know

- Neon has no image that runs its service offline. Its Docker image,
  `neondatabase/neon_local`, is a proxy to a cloud branch: it can create a
  temporary branch when the container starts and delete it on stop. It needs
  a Neon API key, the project id and an internet connection.
- A Neon branch can also be used directly by setting `DATABASE_URL`, with
  no Docker.
- The app already picks Neon when `DATABASE_URL` is set and PGlite
  otherwise (`src/db/index.ts`), so no application change is needed to try
  this.
- The CCPM skill ships `references/scripts/neon-branch.sh`, which creates
  a branch `epic/<name>` for an epic's worktree and removes it on merge. It
  does nothing unless the Neon CLI and `NEON_PROJECT_ID` are present.

## User Stories

### 1. Develop against Neon
As a developer, I run the app locally against my own Neon branch.

Acceptance criteria:
- One documented command gives me a branch and a working `DATABASE_URL`.
- Migrations are applied to that branch before the app starts.
- My branch never touches production data.

### 2. Still works with nothing set up
As a new contributor or CI, the app runs with no Neon access.

Acceptance criteria:
- With no `DATABASE_URL`, `npm run dev` and all CI checks use the
  embedded database, as today.

## Functional Requirements

To be written after the open questions are answered. Expected to cover: how
a branch is created and named, how migrations reach it, where its connection
string is stored, and cleanup.

## Non-Functional Requirements

- Stays within Neon's free plan.
- No secrets in the repository or in logs.
- CI needs no Neon access.

## Success Criteria

- A developer goes from a fresh clone to the app running on a Neon branch in
  under 5 minutes using the documented steps.
- CI remains green with no Neon secrets.

## Constraints & Assumptions

- Hosting is Vercel with its Neon integration; cost must stay free or very
  cheap.
- Neon's free-plan branch limit has not been checked; one dev branch per
  developer is assumed to fit.
- Working against Neon requires an internet connection; offline work falls
  back to the embedded database.

## Out of Scope

- A database branch per epic (`neon-epic-branches`).
- Removing the embedded database.
- Running the Neon service itself locally.
- Branches for Vercel preview deployments (the Vercel integration may
  already handle this; see open questions).

## Dependencies

- A Neon API key and the project id for whoever develops.
- The Neon CLI, and Docker only if Neon Local is chosen.
- No dependency on any other PRD; it can be done at any point.

## Open Questions

1. Neon Local in Docker, or branches used directly through the CLI and
   `neon-branch.sh`?
2. How many branches does Neon's free plan allow? (Whether one per epic is
   affordable belongs to `neon-epic-branches`.)
3. Should the dev branch be long-lived per developer, temporary per session,
   or per git branch?
4. Does the Vercel Neon integration already create a branch per preview
   deployment, and should local work reuse that?
5. Should the embedded database remain the default for `npm run dev`, or
   become the fallback only?
6. How do cloud agent sessions get a Neon API key safely?
