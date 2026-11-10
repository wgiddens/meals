---
name: multi-family
description: Let more than one family use the app, each with its own members, meals, allergy list, plans and settings, fully separated from every other family
status: backlog
created: 2026-11-10T18:52:45Z
---

# PRD: multi-family

> **Draft stub.** This records the idea and what we know so far. It has not
> been through a brainstorm and must be fleshed out before it is parsed into
> an epic. `docs/PRODUCT.md` lists multiple families under "Not now"; that
> entry needs to change before this is scheduled. The open questions at the
> end are the starting point.

## Executive Summary

Today the app serves one family per deployment. This PRD turns it into a
product other families can use: each family has its own members, favourites,
allergy list, weekly plans and settings, and no family can ever see or
change another's.

## Problem Statement

The `accounts` PRD deliberately built one invite-only family, with no
family id on any data, and accepted that opening the app to others would
mean reworking that. `docs/PRODUCT.md` names "multiple families, as a real
product" as the later audience. Until this is done, another household can
only use the app by running its own copy.

## What we know

- `accounts` gives each person an account, an owner role, invitations and
  a single `family` row. People and sessions already exist; what is missing
  is that data belongs to a family.
- Every table added by `core`, `weekly-draft` and later PRDs (meals,
  allergens, plans, settings) carries no family id. Each needs one, and
  every query needs to be limited to the signed-in member's family.
- The allergy rule is absolute. With several families, applying one
  family's list to another's meals, or failing to apply it, is the most
  serious thing that could go wrong.
- Per-deployment settings would become per-family: draft day, busy nights,
  nights off, timezone, the owner email, the assistant (MCP) token.
- Cost is bounded today because the family is invite only. Letting families
  sign up changes that: database size, AI calls for new-meal ideas, email
  volume.
- The later this is done, the more tables and queries need changing.

## User Stories

### 1. Start a family
As someone new, I create a family and become its owner.

Acceptance criteria:
- A new family starts with its own empty favourites list, its own allergy
  list and default settings.
- The person who creates it is its owner and can invite members, as in
  `accounts`.

### 2. Families are separate
As a family member, I only ever see my own family's data.

Acceptance criteria:
- No page, action, scheduled job or assistant tool returns or changes
  another family's meals, allergens, plans, members or settings.
- Automated tests prove this for every table that holds family data.
- Each family's allergy list applies to that family's meals only.

### 3. Each family gets its own weekly draft
As a family, our plan is drafted on our day, by our rules.

Acceptance criteria:
- The scheduled job drafts for every family according to that family's
  draft day, timezone, busy nights and nights off.
- A failure drafting one family does not stop the others.

### 4. Our existing family carries over
As the first family, nothing we have is lost.

Acceptance criteria:
- All existing data is assigned to the existing family with no manual
  re-entry.

## Functional Requirements

To be written after the open questions are answered. Expected to cover: a
family id on all family data and how queries are limited by it, creating a
family, per-family settings and timezone, per-family scheduling, per-family
assistant access, and migrating the existing family.

## Non-Functional Requirements

- Separation between families is enforced in one place in the data layer,
  not left to each query's author, and is covered by automated tests.
- Running cost stays predictable as families are added, with limits on
  whatever costs money per family.
- Hosting stays on Vercel with Neon.

## Success Criteria

- Two families use one deployment and neither can reach the other's data
  by any route, verified by automated tests for every family-owned table.
- The existing family's data is intact after migration.
- Every family with a due draft day receives its draft.
- Cost per additional family is known and capped.

## Constraints & Assumptions

- Builds on `accounts`; its single `family` row becomes one of many.
- Assumes one person belongs to exactly one family until decided otherwise.
- Opening sign-up to the public brings obligations this project has not
  needed so far: abuse protection, terms and privacy, account deletion,
  support. Whether to take those on is a product decision, not a technical
  one.

## Out of Scope

- Billing and paid plans.
- A native app.
- Sharing meals or plans between families.
- An administrator console across all families, beyond what is needed to
  create one.

## Dependencies

- `accounts` complete. In practice also `core` and `weekly-draft`, since
  their tables are what gets a family id.
- `email`, if families are to be invited or to sign up by email.
- A change to `docs/PRODUCT.md`, which currently lists multiple families
  under "Not now".

## Open Questions

1. Who can create a family: only us by invitation, anyone with a link, or
   open sign-up?
2. Should a family id be added to the data model now, while there are few
   tables, even if the rest of this waits?
3. Can one person belong to more than one family (for example shared
   custody, or grandparents)?
4. Is the assistant (MCP) connection per family, per person, or does this
   wait for `mcp-oauth`?
5. What costs money per family (AI new-meal ideas, texts, email) and what
   limits apply?
6. Does public sign-up require terms, a privacy policy and account
   deletion before launch?
7. How is separation enforced: in application queries only, or also with
   database row-level security?
8. Where does this sit on the roadmap relative to phone approval, groceries
   and Walmart?
