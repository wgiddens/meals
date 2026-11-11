---
name: preview-deploys
description: Rethink how Vercel preview deployments are used so the project stays inside the free plan's daily limit and previews stay safe and useful
status: backlog
created: 2026-11-11T03:35:00Z
---

# PRD: preview-deploys

> **Draft stub.** Raised by the stakeholder on 2026-11-11 after the project
> hit Vercel's free-plan limit of 100 deployments a day. It has not been
> through a brainstorm; the open questions at the end are the starting
> point.

## Executive Summary

Every push to any branch builds a Vercel preview. Our way of working (a
branch per task, a review chat, tracking commits on the epic branch, docs
PRs) pushes often, and on 2026-11-11 the project ran out of deployments for
the day. This PRD decides which pushes should deploy, how previews get their
database and sign-in, and how we keep production deploys from being blocked.

## Problem Statement

- **We hit the daily limit.** The free plan allows 100 deployments a day.
  Once it's reached, no preview and no production deploy can be built for
  24 hours, including a merge to `main`.
- **Most pushes don't need a preview.** Tracking commits under `.claude/`,
  PRD and docs changes, and review-fix pushes on a branch nobody is looking
  at each spend a deployment.
- **Previews carry setup and risk.** They need their own sign-in variables
  and a fixed sign-in proxy branch (`epic/accounts`, later `auth-proxy`), and
  they must never share production's database, because every build runs
  migrations.

## User Stories

### 1. Only useful pushes deploy
As the stakeholder, a preview is built only when someone will look at it.

Acceptance criteria:
- Commits that only change `.claude/`, `docs/` or Markdown files don't
  build.
- The rule for which branches and pushes build is written down and
  enforced by configuration, not by habit.

### 2. Production is never blocked by previews
As the family, a merge to `main` always deploys.

Acceptance criteria:
- Preview builds can't use up the deployments production needs, or there
  is a documented fallback when they do.

### 3. Previews are safe
As the stakeholder, testing a preview never touches production data.

Acceptance criteria:
- Preview's database is separate from production's, and a check proves it.
- Preview sign-in works through the fixed proxy branch, as documented in
  `docs/DEPLOY.md`.

## Interim measure (in place before this PRD is built)

A project-wide Ignored Build Step in Vercel (Settings → Git) skips builds
when a commit changes nothing outside `.claude/`, `docs/` and Markdown
files.

## Open Questions

1. Should every PR still get a preview, or only the final epic PR and PRs
   marked ready for review?
2. Should task branches build at all, or only `epic/*`, `auth-proxy` and
   `main`?
3. Does the orchestrator flow change: fewer pushes (batched tracking
   commits), or tracking moved off the deployed branches?
4. Preview database: one shared Preview database, Neon branch per preview,
   or none (previews that need data use a seed)?
5. Is a paid plan worth it later, and at what point?
6. How does this interact with `custom-domain` and the `auth-proxy` branch?

## Out of Scope

- Moving off Vercel.
- Changing production hosting.

## Dependencies

- None. The interim measure can be applied today; the rest can be planned
  any time.
