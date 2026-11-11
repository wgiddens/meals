---
name: weekly-draft
description: A scheduled job drafts the coming week's dinners from the favourites list, honouring the hard rules, and shows the plan on a week page with a Redraft button
status: backlog
created: 2026-11-10T16:23:13Z
updated: 2026-11-11T03:30:00Z
---

# PRD: weekly-draft

## Executive Summary

Every week, without anyone starting it, the app drafts seven nights of dinner
and saves the plan. Plain, testable code chooses from the favourites list
using the hard rules in `docs/PRODUCT.md`: allergies, busy nights, no recent
repeats. The draft is visible on a week page and can be redrafted.

This is the MVP cut (stakeholder's decision, 2026-11-11). Split out to their
own PRDs, built after this one:
- `nights-off`: weekday default nights off and one-off nights off.
- `new-meal`: a to-try list and one new meal a week, suggested by Claude
  when the list is empty.
- `assistant-tools`: MCP tools for assistants.

Texting the plan to phones, approving and swapping belong to
`phone-approval`; ratings belong to `feedback-loop`.

This is roadmap item 1 and builds on the `core` PRD.

## Problem Statement

"What's for dinner" gets decided at 5 o'clock because planning requires
someone to sit down and recall meals from a blank slate. The product's job is
to take that off the family's plate entirely, so the plan must appear on its
own, already sensible: nothing with peanuts, nothing slow on church night,
not the same thing as last week.

After `core`, the app holds a favourites list but does nothing with it. This
PRD is the first one that delivers the product's central promise.

## User Stories

### 1. A plan shows up on its own
As Shannon or Will, I find the coming week's dinners already drafted on
draft day without doing anything.

Acceptance criteria:
- On the configured draft day (default Saturday) a scheduled job saves a
  draft plan for the next seven days, starting the day after draft day.
- The draft is saved by early afternoon in the household timezone.
- If a plan for that week already exists, the scheduled job leaves it alone.
- Every one of the seven nights has an entry: a meal or "Pick something up".
- No one has to open the app, sign in or press anything for this to happen.

### 2. The plan respects our rules
As a parent, I can trust the draft without checking it.

Acceptance criteria:
- No drafted meal is excluded by the allergy list. The draft uses the shared
  allow/exclude function from `core`.
- A night marked busy gets only a `quick` or `pick-up` meal. Wednesday is
  busy by default.
- No meal appears twice in the same week.
- A meal cooked in the last 21 days is not drafted when enough other
  eligible meals exist; when they don't, the least recently cooked eligible
  meals are used first.
- When a busy night has no eligible quick or pick-up meal, the entry is a
  generic "Pick something up" rather than an empty night or a slow meal.

### 3. Redraft the week
As Shannon or Will, I ask for a different draft if this one doesn't suit.

Acceptance criteria:
- A "Redraft" button on the week page replaces the meals on nights that
  haven't passed.
- A redraft avoids the meals it is replacing where enough alternatives
  exist.

### 4. See the week
As anyone in the house, I open the app and see what's for dinner.

Acceptance criteria:
- A week page shows the current week and, once drafted, the coming week:
  each date with its meal name and effort tag.
- Tonight's entry is visually distinct.
- The page works one-handed at 375 px width and sits behind family
  sign-in.

## Functional Requirements

### Week plan
- A week is seven consecutive dates starting the day after draft day. With
  the default Saturday draft, a week runs Sunday to Saturday.
- Each date holds one entry: a meal from the meals list, or a generic
  "Pick something up" entry.
- A week has a status. Only `draft` is used in this PRD; `phone-approval`
  adds approval and locking.
- Each entry records whether it was placed by the draft or set by hand, so
  later PRDs (`nights-off`) can keep hand-made choices through a redraft.

### Draft rules, in order
1. Remove excluded meals (allergy) from the candidates.
2. Fill busy nights from `quick` and `pick-up` favourites, least recently
   cooked first; fall back to "Pick something up".
3. Fill the remaining nights from favourites, least recently cooked first,
   skipping meals cooked within 21 days when enough others exist.
4. Never place the same meal twice in one week.

The rules are deterministic code with automated tests. Given the same
meals, history, settings and a fixed random seed, the draft is the same.

### Cook history
- For now, a planned meal counts as cooked once its date has passed.
  "Pick something up" entries do not count.
- "Last cooked" for a meal is the most recent such date, and is shown next
  to the meal on the favourites list.
- How cooking is confirmed, corrected and rated is deliberately left to the
  `feedback-loop` PRD. Nothing here should make that harder: history must
  remain a per-date record that can later carry "we didn't have this" and a
  rating.

### Settings
Added to the settings page from `core`:
- Draft day (default Saturday).
- For each weekday: busy or relaxed (Wednesday busy by default).

### Scheduling
- A daily scheduled job on Vercel checks whether today is draft day in the
  household timezone and, if so, drafts the coming week.
- The job's endpoint accepts only Vercel's signed cron request.
- Running the job twice on the same day changes nothing the second time.

## Non-Functional Requirements

- **Cost:** stays on Vercel's free plan and Neon's free tier. No AI calls in
  this PRD.
- **Reliability:** a draft with zero favourites available fills nights with
  "Pick something up" rather than failing.
- **Speed:** a draft completes in under 2 seconds.
- **Testability:** every draft rule in "Draft rules, in order" has an
  automated test, including the allergy exclusion, the busy-night rule and
  the 21-day window with too few meals.
- **Zero-setup local development:** `npm run dev` still works with no
  services and no keys; a draft can be triggered locally by button or
  script.
- **Security:** pages behind family sign-in (`accounts`); the scheduled
  endpoint behind Vercel's cron secret.
- **Quality gates:** typecheck, lint, smoke check and build green in CI.

## Success Criteria

- For four consecutive weeks on the hosted app, a draft exists by 2 pm
  household time on draft day with no one triggering it.
- 100% of drafted meals pass the allergy check, verified by automated tests
  and by a check that runs inside the draft itself before saving.
- 100% of busy-night entries are `quick`, `pick-up` or "Pick something up".
- No drafted week contains a duplicate meal.
- With the eight starting favourites, no meal repeats within 7 days and the
  least recently cooked are always chosen first.
- Monthly running cost is $0.

## Constraints & Assumptions

- **Stack is fixed** as in `core`: Next.js 16, Drizzle, PGlite locally,
  Vercel with Neon. Follow `AGENTS.md` and read the bundled Next.js docs
  first.
- **Vercel's free plan limits scheduled jobs** to once a day with loose
  timing. So draft day is a setting, but the time of day is fixed in the
  deployment configuration, early enough to be ready by early afternoon
  Eastern. This should be confirmed against Vercel's current limits when the
  epic is written.
- **Only one quick favourite is seeded** (breakfast-for-dinner). Until the
  family adds more quick or pick-up meals, busy Wednesdays will alternate
  between it and "Pick something up". That is expected behaviour, not a
  defect.
- **21 days cannot hold with a short list.** Eight favourites and seven
  cooked nights a week means repeats inside three weeks; the rule degrades
  to least-recently-cooked-first by design.
- **Planned equals cooked** is knowingly imprecise and is revisited in
  `feedback-loop`.
- Single household: one set of settings, one plan per week.

## Out of Scope

- Nights off, by weekday default or for one week (`nights-off`).
- A to-try list and a new meal each week (`new-meal`).
- MCP tools for assistants (`assistant-tools`), and OAuth for them
  (`mcp-oauth`).
- Text messages and any notification that a draft is ready
  (`phone-approval`).
- Approve, lock and per-night Swap to a chosen favourite (`phone-approval`).
- Loved it / Never again, confirming or correcting what was cooked, and
  graduation to favourites (`feedback-loop`).
- Grocery lists and pantry staples (`grocery-list`).
- The "try these?" stack, photo and link capture (`find-new-meals`).
- Drafting breakfasts or lunches; recurring themed slots such as taco night;
  planning more than one week ahead.
- A user-editable draft time of day; deferred to `phone-approval`, where the
  text is sent.

## Dependencies

- **`core` PRD, complete:** the meals list with effort tags and ingredients,
  the allergy list and its shared allow/exclude function, the settings
  page.
- **`accounts` PRD, complete:** sign-in and the signed-in-member check.
- `docs/PRODUCT.md` – hard rules and roadmap order; it wins on conflict.
- Vercel scheduled jobs on the free plan, with a cron secret.
- `HOUSEHOLD_TIMEZONE` (already used) to decide what "today" and "draft
  day" mean.
