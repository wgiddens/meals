---
name: core
description: Rebuild the app's foundation around a favourites list of dinners with an absolute allergy filter, simple phone pages to manage it, and the household passcode
status: backlog
created: 2026-11-10T15:54:07Z
---

# PRD: core

## Executive Summary

The code in the repo today is a prototype. It was built before the product
vision in `docs/PRODUCT.md` and is centred on a recipe book, which the vision
lists under "Not now". This PRD replaces it, in place, with the smallest
foundation every roadmap item needs: a **favourites list of dinners**, a
**household allergy list that is an absolute filter**, **simple phone pages**
to manage both, and the existing **household passcode** in front of them.

Nothing here plans a week. Week plans, cook history and assistant (MCP) access
are specified in the `weekly-draft` PRD, which builds directly on this one.

## Problem Statement

The weekly draft (roadmap item 1) needs a list of dinners the family already
likes, each tagged with prep effort and checked against the allergy list. The
prototype cannot supply that:

- Its unit is a recipe (steps, prep and cook minutes, complexity, 1–5 rating),
  not a meal the family reacts to. There is no effort tag of quick, normal or
  pick-up, and no way to hold a pick-up meal at all.
- It has no allergy list. The peanut rule in `docs/PRODUCT.md` is enforced
  nowhere.
- It carries features the roadmap places later (grocery list, photo and link
  capture) built on that recipe model, so they would have to be reworked
  anyway.

There are no real users and no real data, so now is the cheapest moment to
replace the foundation rather than bend it.

## User Stories

### 1. See the favourites list
As Shannon or Will, I open the app on my phone and see the dinners we like.

Acceptance criteria:
- The home page lists every meal by name with its effort tag (quick, normal,
  pick-up).
- Favourites and meals to try are shown as separate groups.
- A meal that conflicts with the allergy list is visibly marked as excluded.
- A meal with no ingredients yet (other than pick-up) is visibly marked as
  needing ingredients.
- The page is usable one-handed at 375 px width with no horizontal scrolling.

### 2. Add a meal in seconds
As Shannon or Will, I add a dinner we like without it feeling like work.

Acceptance criteria:
- Only a name and an effort tag are required. Ingredients are optional and can
  be added later.
- Adding a meal with name and effort takes no more than three taps after
  typing the name.
- Ingredients are entered as plain lines, one per ingredient, with an optional
  quantity and unit.
- A meal name that already exists (ignoring case) is rejected with a clear
  message.
- A meal whose name or any ingredient matches the allergy list cannot be
  saved; the message names the allergen and the line that matched.

### 3. Edit or remove a meal
As Shannon or Will, I fix a meal's details or take it off the list.

Acceptance criteria:
- Name, effort tag, ingredients and list (favourite or to try) can all be
  changed.
- The allergy check runs on every save, the same as on add.
- Removing a meal asks for one confirmation and then deletes it.

### 4. Manage the allergy list
As a parent, I know that nothing containing an allergen can be on our list.

Acceptance criteria:
- A settings page shows the allergy list. It starts with "peanut".
- An allergen can be added or removed in one step each.
- Adding an allergen immediately marks every existing meal that matches it as
  excluded. Those meals stay visible so they can be fixed or removed.
- Removing an allergen clears the exclusion from meals that matched only it.

### 5. Start with our eight favourites
As the family, the list is not empty on day one.

Acceptance criteria:
- A fresh install, local or hosted, contains the eight starting favourites
  from `docs/PRODUCT.md`, each with an effort tag and ingredients, all passing
  the allergy check.
- Seeding runs once. Running it again adds no duplicates and overwrites no
  edits.

### 6. Keep the app to our household
As the family, only we can see or change the list.

Acceptance criteria:
- With `HOUSEHOLD_PASSCODE` set, every page and every write requires a signed-
  in device; each phone enters the passcode once.
- With it unset, local development works with no sign-in.

## Functional Requirements

### Meals
- A meal has: name (unique, case-insensitive), effort (`quick`, `normal`,
  `pick-up`), list (`favourite` or `to-try`), an ordered set of ingredients,
  and created/updated timestamps.
- An ingredient has: name (required), quantity and unit (both optional).
- Pick-up meals need no ingredients and are never marked as needing them.
- Meals have no steps, times, complexity, rating or source in this PRD.

### Allergy list
- A household-wide list of allergen terms, seeded with `peanut`.
- A meal matches an allergen when the term appears, ignoring case, anywhere in
  the meal name or in any ingredient name. "peanut" therefore matches "peanut
  butter", "Peanuts" and "peanut oil".
- A matching meal can never be created or saved. A meal that starts matching
  because an allergen was added later is marked excluded.
- One shared function decides whether a meal is allowed. Every later feature
  (weekly draft, swaps, groceries, new-meal suggestions) must use it rather
  than re-implement the check.

### Pages
- Home: the favourites list (story 1), with a way to add a meal.
- Add / edit meal: one form (stories 2 and 3).
- Settings: the allergy list (story 4) and sign out.
- Login: the existing passcode page.

### Prototype removal
Removed from the app in this PRD. The code stays in git history and each
feature returns when its own PRD is built.

| Removed | Returns in |
|---|---|
| Recipe book (steps, times, complexity, rating) | Not planned ("Not now") |
| Week plan page and "mark as cooked" | `weekly-draft`, `phone-approval`, `feedback-loop` |
| Grocery list | `grocery-list` |
| Photo → recipe, import from link | `find-new-meals` |
| MCP endpoint and its 13 tools | `weekly-draft` (rebuilt on the new model) |

- The database schema is replaced with a new one. Prototype tables are
  dropped; no prototype data is migrated.
- Pieces that still fit may be carried over rather than rewritten: the
  passcode gate, the date helpers, the local/hosted database switch, the CI
  workflow.

## Non-Functional Requirements

- **Cost:** runs on Vercel's free plan with the free tier of Vercel's Neon
  Postgres integration. No paid service is required. No AI calls are made in
  this PRD.
- **Zero-setup local development:** `npm run dev` works with no services
  installed and no environment variables, using the embedded database.
- **Mobile first:** every page works at 375 px width; tap targets are at least
  44 px.
- **Safety of the allergy rule:** the allow/exclude function has automated
  tests covering match in name, match in ingredient, case differences, and an
  allergen added after the meal.
- **Quality gates:** typecheck, lint, the data-layer smoke check and the
  production build all pass in CI on every pull request.

## Success Criteria

- A fresh deployment shows the eight starting favourites, with zero allergy
  conflicts, without any manual data entry.
- Adding a meal by name and effort takes under 15 seconds on a phone.
- Attempting to save a meal named or containing "peanut" (any case) fails
  100% of the time, verified by automated tests.
- Adding a second allergen marks every matching existing meal as excluded,
  verified by an automated test.
- The hosted app costs $0 per month at household usage.
- No prototype route (`/recipes`, `/plan`, `/grocery`, `/api/plate`,
  `/api/import`, `/api/mcp`) responds with content after this ships.
- CI is green with all four checks.

## Constraints & Assumptions

- **Stack is fixed:** Next.js 16, Tailwind 4, Postgres through Drizzle, PGlite
  locally, Vercel hosting with Neon Postgres. Follow `AGENTS.md`: read the
  bundled Next.js docs before writing code.
- **Docs to correct:** `README.md`, `.env.example`, `docs/ARCHITECTURE.md` and
  a comment in `src/db/index.ts` name Supabase as the hosted database. The
  deployment uses Vercel's Neon integration; the epic updates these.
- **Allergen matching is by text.** It cannot know that an ingredient with an
  innocent name contains an allergen (for example a bottled sauce). The family
  remains responsible for what they type in; label checking is out of scope.
- **Single household.** One allergy list and one meals list for the whole
  deployment; no household or user ids in the schema.
- **Vercel and Neon free tiers** are assumed to stay sufficient for one
  household. If either changes, cost is revisited before adding a paid plan.
- The eight starting favourites need ingredient lists written as part of the
  seed; these are a reasonable first draft the family can edit, not a recipe.

## Out of Scope

- Week plans, drafting, nights off, and cook history (`weekly-draft`).
- Any MCP or assistant access (`weekly-draft`, `mcp-oauth`).
- Texts, approval and swaps (`phone-approval`).
- Loved it / Never again ratings and graduation from to-try to favourite
  (`feedback-loop`). In this PRD a meal's list is changed by hand.
- Grocery lists, aisles, pantry staples and Walmart item ids (`grocery-list`,
  `walmart-pickup`).
- The "try these?" stack, photo capture and link import (`find-new-meals`).
- Recipe steps, cook times, servings, nutrition.
- Multiple families, user accounts, per-person sign-in.
- Growing the list from 8 to 15–20 favourites: that is done by the family
  using these pages, not by this build.

## Dependencies

- `docs/PRODUCT.md` – hard rules, starting favourites and roadmap order. It
  wins where this PRD disagrees.
- The existing Vercel project and its Neon database (`DATABASE_URL`).
- `HOUSEHOLD_PASSCODE` set on the deployment.
- Nothing upstream: this is the first PRD. `weekly-draft` depends on it.
