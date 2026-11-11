---
name: new-meal
description: A to-try list of meals, and one new meal in each weekly draft, taken from that list or suggested by Claude when it is empty
status: backlog
created: 2026-11-11T03:30:00Z
---

# PRD: new-meal

## Executive Summary

Each drafted week carries at most one new meal, clearly marked, so the
family is nudged to try something. It comes from a to-try list the family
keeps; when that list has nothing unplanned, Claude suggests a meal that
resembles the favourites.

Split out of `core` (the to-try list) and `weekly-draft` (the weekly new
meal) as part of the MVP cut (stakeholder's decision, 2026-11-11). Builds on
`weekly-draft`.

## Problem Statement

Without a nudge, the draft cycles through the same favourites forever.
`docs/PRODUCT.md` asks for one new meal a week that resembles what the family
already likes.

## User Stories

### 1. Keep a list of meals to try
As Shannon or Will, I add a meal we want to try without calling it a
favourite.

Acceptance criteria:
- A meal is on one of two lists: favourite or to try. The add and edit form
  lets you choose; the default is favourite.
- The home page shows favourites and meals to try as separate groups.
- A meal can be moved between the lists by hand.
- The allergy check applies to meals to try exactly as to favourites.

### 2. One new meal a week
As the family, we are nudged to try something we wouldn't have thought of.

Acceptance criteria:
- Each drafted week contains at most one new meal, labelled "New" wherever
  the plan is shown.
- The new meal is placed on a night that is not busy and not a night off.
- If the to-try list holds a meal not yet planned, the oldest such meal is
  used and no AI call is made.
- Otherwise Claude proposes one meal resembling the favourites: a name, an
  effort tag (`quick` or `normal`, about 30 minutes) and ingredients. It is
  saved to the to-try list and then planned.
- A proposal that fails the allergy check or duplicates an existing meal
  name is discarded; after one retry the week goes ahead without a new meal.
- If no API key is set or the call fails, the draft still completes using
  favourites only.
- A redraft reuses the week's existing new meal rather than calling Claude
  again.
- If the night holding the new meal is turned off (`nights-off`), the new
  meal moves to another eligible night when one is available.

## Functional Requirements

- A meal gains a list: `favourite` or `to-try`. Existing meals are
  favourites.
- A week entry gains an "is new" flag.
- The draft's regular fill (`weekly-draft`'s rules) uses favourites only;
  meals on the to-try list are placed only as the week's new meal.
- The new meal is placed before the regular fill: after nights off are
  applied (when `nights-off` exists), and before busy nights and the
  remaining nights are filled.
- One Claude call at most per drafted week, and none when the to-try list
  has an unplanned meal.
- The request sends the favourites' names and the allergy list, and asks for
  a structured result: name, effort, ingredient lines.
- The result is validated in code (allergy function, unique name, effort is
  `quick` or `normal`) before it is saved. The model is never trusted to
  enforce the allergy rule.
- A new meal stays on the to-try list after it is planned; moving it to
  favourites remains a manual edit until `feedback-loop`.

## Non-Functional Requirements

- **Cost:** at most one small Claude call a week, using the least expensive
  model that returns reliable structured output; target under $1 per month.
- **Reliability:** a failed AI call, a missing API key or an empty to-try
  list never prevents a draft.
- **Speed:** a draft with an AI call completes in under 20 seconds.
- **Testability:** automated tests cover the to-try path, the no-AI
  fallback, and a rejected proposal.

## Success Criteria

- No drafted week ever has more than one new meal. A week has exactly one
  when a to-try meal or a valid AI proposal is available and at least one
  night is neither busy nor off; otherwise it has none and the draft still
  completes.
- Monthly AI cost is under $1.

## Constraints & Assumptions

- Claude's suggestion is a starting point; the family edits or removes it
  like any other meal.
- Without `ANTHROPIC_API_KEY`, new meals come only from the to-try list.

## Out of Scope

- The "try these?" swipe stack, photo and link capture (`find-new-meals`).
- Graduating a meal to favourites from ratings (`feedback-loop`).

## Dependencies

- `weekly-draft`, complete. `nights-off` is not required, but the
  placement rule above applies once it exists.
- `ANTHROPIC_API_KEY` on the deployment (optional; without it, new meals come
  only from the to-try list).
