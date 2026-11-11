---
name: nights-off
description: Weekday default nights off and one-off nights off for a single week, kept through drafts and redrafts
status: backlog
created: 2026-11-11T03:30:00Z
---

# PRD: nights-off

## Executive Summary

Some nights the family doesn't cook: a regular eat-out night, or "we're
meeting friends on Tuesday". This PRD lets the weekly draft know. Each
weekday can default to a night off, and any single night can be turned off
or back on for one week.

Split out of `weekly-draft` as part of the MVP cut (stakeholder's decision,
2026-11-11). Builds on `weekly-draft`.

## Problem Statement

After `weekly-draft`, every night gets a meal. A family that eats out every
Friday, or has plans on a given night, has to ignore the plan for that night
and loses trust in it.

## User Stories

### 1. Default nights off
As the family, the plan already knows the nights we usually don't cook.

Acceptance criteria:
- Settings list the seven weekdays. Each can be set to cook (default) or
  night off, with a label of "Eat out" or "Leftovers".
- The draft puts a night off on every weekday set that way.
- Changing the setting affects future drafts only, not a week already
  drafted.

### 2. Change a night for just this week
As Shannon or Will, I tell the app we won't cook on a particular night this
week.

Acceptance criteria:
- On the week page, any night that hasn't passed can be turned into a night
  off in two taps, with an optional short note ("Supper with friends").
- A night off, including one that came from a weekday default, can be
  turned back into a cooked night for that week; the rules then fill it
  with an eligible meal, and it stays a cooked night through a redraft.
- A night off can be set on the week page for any date in the current or
  coming week, even before the coming week is drafted, and is kept when the
  draft runs. A week counts as drafted (for `weekly-draft`'s "leave an
  existing plan alone") only once the draft has run, not because a night
  off was set in it.
- These changes apply to that date only and never alter the weekday
  defaults.

## Functional Requirements

- A week entry can also be a night off, with a label (Eat out, Leftovers)
  and an optional note.
- Draft rules gain two steps at the front, before `weekly-draft`'s rules:
  1. keep every choice already made by hand for the week (nights turned off,
     and nights turned back into cooked nights);
  2. apply weekday default nights off to the nights with no hand-made
     choice.
- A redraft keeps hand-set nights off.
- Nights off do not count as cooked.
- The week page shows a night off's label and note.

## Non-Functional Requirements

- **Testability:** automated tests cover weekday defaults, hand-set nights
  off surviving a draft and a redraft, and a night turned back on.
- **Mobile first:** two taps at 375 px.

## Success Criteria

- Marking a night off for this week takes two taps and survives a redraft.
- With two default nights off, every drafted week has those nights off.

## Constraints & Assumptions

- Single household: one set of weekday defaults.
- A night off is per date; there is no recurring calendar.

## Out of Scope

- Moving the week's new meal off a night that is turned off (`new-meal`
  handles placement once both exist).
- Recurring exceptions other than weekday defaults.

## Dependencies

- `weekly-draft`, complete.
