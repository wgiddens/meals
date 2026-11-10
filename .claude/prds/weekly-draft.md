---
name: weekly-draft
description: A scheduled job drafts the coming week's dinners from the favourites list, honouring the hard rules and nights off, with one new meal, and exposes the plan on a week page and over MCP
status: backlog
created: 2026-11-10T16:23:13Z
---

# PRD: weekly-draft

## Executive Summary

Every week, without anyone starting it, the app drafts seven nights of dinner
and saves the plan. Plain, testable code chooses from the favourites list
using the hard rules in `docs/PRODUCT.md`: allergies, busy nights, no recent
repeats. One night carries a new meal, clearly marked. Some nights are
planned nights off, set by default per weekday and changeable for any single
week ("we're meeting friends on Tuesday").

The draft is visible on a week page and available to assistants over MCP.
Texting it to phones, approving and swapping belong to `phone-approval`;
ratings belong to `feedback-loop`.

This is roadmap item 1 and builds on the `core` PRD.

## Problem Statement

"What's for dinner" gets decided at 5 o'clock because planning requires
someone to sit down and recall meals from a blank slate. The product's job is
to take that off the family's plate entirely, so the plan must appear on its
own, already sensible: nothing with peanuts, nothing slow on church night,
not the same thing as last week, and with a nudge to try something new.

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
- Every one of the seven nights has an entry: a meal, or a night off.
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
- Meals marked as needing ingredients may still be drafted.

### 3. One new meal a week
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

### 4. Default nights off
As the family, the plan already knows the nights we usually don't cook.

Acceptance criteria:
- Settings list the seven weekdays. Each can be set to cook (default) or
  night off, with a label of "Eat out" or "Leftovers".
- The draft puts a night off on every weekday set that way.
- Changing the setting affects future drafts only, not a week already
  drafted.

### 5. Change a night for just this week
As Shannon or Will, I tell the app we won't cook on a particular night this
week.

Acceptance criteria:
- On the week page, any night that hasn't passed can be turned into a night
  off in two taps, with an optional short note ("Supper with friends").
- A night off can be turned back into a cooked night; the rules then fill
  that night with an eligible meal.
- A night off set for a date before its week is drafted is kept when the
  draft runs.
- These changes apply to that date only and never alter the weekday
  defaults.
- If the night turned off held the week's new meal, the new meal moves to
  another eligible night when one is available.

### 6. Redraft the week
As Shannon or Will, I ask for a different draft if this one doesn't suit.

Acceptance criteria:
- A "Redraft" button on the week page replaces the meals on nights that
  haven't passed.
- Nights off set by hand for that week are kept.
- A redraft avoids the meals it is replacing where enough alternatives
  exist.
- A redraft reuses the week's existing new meal rather than calling Claude
  again.

### 7. See the week
As anyone in the house, I open the app and see what's for dinner.

Acceptance criteria:
- A week page shows the current week and, once drafted, the coming week:
  each date with its meal name and effort tag, or its night off label and
  note.
- Tonight's entry is visually distinct.
- The page works one-handed at 375 px width and sits behind the household
  passcode.

### 8. Ask an assistant
As Shannon or Will, I ask Claude, ChatGPT or Gemini about the plan or tell
it to change it.

Acceptance criteria:
- An MCP endpoint, protected by a bearer token, offers these tools:
  `whats_for_supper`, `get_week_plan`, `suggest_week` (draft or redraft),
  `set_night_off`, `clear_night_off`, `list_meals`, `add_meal`.
- Every tool goes through the same library functions as the pages, so the
  rules cannot be bypassed: `add_meal` runs the allergy check, and
  `suggest_week` produces the same result the scheduled job would.
- There is no tool that deletes a meal.

## Functional Requirements

### Week plan
- A week is seven consecutive dates starting the day after draft day. With
  the default Saturday draft, a week runs Sunday to Saturday.
- Each date holds at most one entry, one of:
  - a meal from the meals list, with an "is new" flag;
  - a generic "Pick something up" entry;
  - a night off, with a label (Eat out, Leftovers) and an optional note.
- A week has a status. Only `draft` is used in this PRD; `phone-approval`
  adds approval and locking.
- Each entry records whether it was placed by the draft or set by hand, so
  a redraft knows what to keep.

### Draft rules, in order
1. Keep every night off already set by hand for the week.
2. Apply weekday default nights off to the remaining nights.
3. Remove excluded meals (allergy) from the candidates.
4. Place the new meal on a night that is neither busy nor off.
5. Fill busy nights from `quick` and `pick-up` favourites, least recently
   cooked first; fall back to "Pick something up".
6. Fill the remaining nights from favourites, least recently cooked first,
   skipping meals cooked within 21 days when enough others exist.
7. Never place the same meal twice in one week.

The rules are deterministic code with automated tests. Given the same
meals, history, settings and a fixed random seed, the draft is the same.

### Cook history
- For now, a planned meal counts as cooked once its date has passed. Nights
  off and "Pick something up" entries do not count.
- "Last cooked" for a meal is the most recent such date, and is shown next
  to the meal on the favourites list.
- How cooking is confirmed, corrected and rated is deliberately left to the
  `feedback-loop` PRD. Nothing here should make that harder: history must
  remain a per-date record that can later carry "we didn't have this" and a
  rating.

### New-meal proposal
- One Claude call at most per drafted week, and none when the to-try list
  has an unplanned meal.
- The request sends the favourites' names and the allergy list, and asks
  for a structured result: name, effort, ingredient lines.
- The result is validated in code (allergy function, unique name, effort is
  `quick` or `normal`) before it is saved. The model is never trusted to
  enforce the allergy rule.

### Settings
Added to the settings page from `core`:
- Draft day (default Saturday).
- For each weekday: busy or relaxed (Wednesday busy by default), and cook or
  night off with its label (all cook by default).

### Scheduling
- A daily scheduled job on Vercel checks whether today is draft day in the
  household timezone and, if so, drafts the coming week.
- The job's endpoint accepts only Vercel's signed cron request.
- Running the job twice on the same day changes nothing the second time.

## Non-Functional Requirements

- **Cost:** stays on Vercel's free plan and Neon's free tier. AI spend is at
  most one small Claude call a week, using the least expensive model that
  returns reliable structured output; target under $1 per month.
- **Reliability:** a failed AI call, a missing API key or an empty to-try
  list never prevents a draft. A draft with zero favourites available fills
  nights with "Pick something up" rather than failing.
- **Speed:** a draft without an AI call completes in under 2 seconds; with
  one, under 20 seconds.
- **Testability:** every draft rule in "Draft rules, in order" has an
  automated test, including the allergy exclusion, the busy-night rule, the
  21-day window with too few meals, hand-set nights off surviving a draft
  and a redraft, and the no-AI fallback.
- **Zero-setup local development:** `npm run dev` still works with no
  services and no keys; a draft can be triggered locally by button or
  script.
- **Security:** pages behind the household passcode; MCP behind its bearer
  token; the scheduled endpoint behind Vercel's cron secret.
- **Quality gates:** typecheck, lint, smoke check and build green in CI.

## Success Criteria

- For four consecutive weeks on the hosted app, a draft exists by 2 pm
  household time on draft day with no one triggering it.
- 100% of drafted meals pass the allergy check, verified by automated tests
  and by a check that runs inside the draft itself before saving.
- 100% of busy-night entries are `quick`, `pick-up` or "Pick something up".
- No drafted week contains a duplicate meal.
- With the eight starting favourites and two nights off, no meal repeats
  within 7 days and the least recently cooked are always chosen first.
- Marking a night off for this week takes two taps and survives a redraft.
- Each drafted week has exactly one new meal whenever an API key is set or
  the to-try list is non-empty, and zero otherwise, never more.
- An assistant connected over MCP can answer "what's for supper?" and can
  redraft the week.
- Monthly running cost is under $1.

## Constraints & Assumptions

- **Stack is fixed** as in `core`: Next.js 16, Drizzle, PGlite locally,
  Vercel with Neon. Follow `AGENTS.md` and read the bundled Next.js docs
  first.
- **Vercel's free plan limits scheduled jobs** to once a day with loose
  timing. So draft day is a setting, but the time of day is fixed in the
  deployment configuration, early enough to be ready by early afternoon
  Eastern. A user-editable delivery time is deferred to `phone-approval`,
  where the text is sent. This should be confirmed against Vercel's current
  limits when the epic is written.
- **Only one quick favourite is seeded** (breakfast-for-dinner). Until the
  family adds more quick or pick-up meals, busy Wednesdays will alternate
  between it and "Pick something up". That is expected behaviour, not a
  defect.
- **21 days cannot hold with a short list.** Eight favourites and about five
  cooked nights a week means repeats inside three weeks; the rule degrades
  to least-recently-cooked-first by design.
- **Planned equals cooked** is knowingly imprecise and is revisited in
  `feedback-loop`.
- A new meal stays on the to-try list after it is planned; moving it to
  favourites remains a manual edit until `feedback-loop`.
- Single household: one set of settings, one plan per week.

## Out of Scope

- Text messages and any notification that a draft is ready
  (`phone-approval`).
- Approve, lock and per-night Swap to a chosen favourite (`phone-approval`).
  In this PRD a night can be turned off or the week redrafted, not swapped
  to a specific meal.
- Loved it / Never again, confirming or correcting what was cooked, and
  graduation to favourites (`feedback-loop`).
- Grocery lists and pantry staples (`grocery-list`).
- The "try these?" stack, photo and link capture (`find-new-meals`).
- OAuth for assistants (`mcp-oauth`); the bearer token stays.
- Drafting breakfasts or lunches; recurring themed slots such as taco night;
  planning more than one week ahead.
- A user-editable draft time of day.

## Dependencies

- **`core` PRD, complete:** the meals list with effort tags and ingredients,
  the allergy list and its shared allow/exclude function, the settings
  page, the passcode gate.
- `docs/PRODUCT.md` – hard rules and roadmap order; it wins on conflict.
- Vercel scheduled jobs on the free plan, with a cron secret.
- `ANTHROPIC_API_KEY` on the deployment (optional; without it, no new meal).
- `MCP_API_KEY` on the deployment for assistant access.
- `HOUSEHOLD_TIMEZONE` (already used) to decide what "today" and "draft
  day" mean.
