---
name: core
description: Rebuild the app's foundation around a favourites list of dinners with an absolute allergy filter, and simple phone pages to manage it, behind family accounts
status: backlog
created: 2026-11-10T15:54:07Z
updated: 2026-11-11T03:30:00Z
---

# PRD: core

## Executive Summary

The code in the repo today is a prototype. It was built before the product
vision in `docs/PRODUCT.md` and is centred on a recipe book, which the vision
lists under "Not now". This PRD replaces it, in place, with the smallest
foundation every roadmap item needs: a **favourites list of dinners**, a
**household allergy list that is an absolute filter**, and **simple phone
pages** to manage both, all behind the sign-in from the `accounts` PRD.

This is the MVP cut (stakeholder's decision, 2026-11-11): a meal to try
and the "needs ingredients" marker move to `new-meal` and `meal-details`.

Nothing here plans a week. Week plans and cook history are specified in the
`weekly-draft` PRD, which builds directly on this one.

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
- A meal that conflicts with the allergy list is visibly marked as excluded.
- The page is usable one-handed at 375 px width with no horizontal scrolling.

### 2. Add a meal in seconds
As Shannon or Will, I add a dinner we like without it feeling like work.

Acceptance criteria:
- Only a name and an effort tag are required. Ingredients are optional and can
  be added later.
- Adding a meal with name and effort takes no more than three taps after
  typing the name.
- Ingredients are entered as plain lines, one per ingredient.
- A meal name that already exists (ignoring case) is rejected with a clear
  message.
- A meal whose name or any ingredient matches the allergy list cannot be
  saved; the message names the allergen and the line that matched.

### 3. Edit or remove a meal
As Shannon or Will, I fix a meal's details or take it off the list.

Acceptance criteria:
- Name, effort tag and ingredients can all be changed.
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
- Every page and every write in this PRD requires a signed-in family
  member, using the sign-in check provided by `accounts`.
- Owner and member can do everything in this PRD equally.
- Local development works with no sign-in setup, as `accounts` provides.

## Functional Requirements

### Meals
- A meal has: name (unique, case-insensitive), effort (`quick`, `normal`,
  `pick-up`), an ordered list of ingredient lines, and created/updated
  timestamps. Every meal in this PRD is a favourite.
- An ingredient is one plain line of text.
- Pick-up meals need no ingredients.
- Meals have no steps, times, complexity, rating, source, quantities or units
  in this PRD. Quantities and units come in `meal-details`; a to-try list
  comes in `new-meal`.

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
- Settings: the allergy list (story 4), with links to the family and
  account pages from `accounts`.
- Sign-in, family and account pages come from `accounts` and are kept.

### Prototype removal
Removed from the app in this PRD. The code stays in git history and each
feature returns when its own PRD is built.

| Removed | Returns in |
|---|---|
| Recipe book (steps, times, complexity, rating) | Not planned ("Not now") |
| Week plan page and "mark as cooked" | `weekly-draft`, `phone-approval`, `feedback-loop` |
| Grocery list | `grocery-list` |
| Photo → recipe, import from link | `find-new-meals` |
| MCP endpoint and its 13 tools | `assistant-tools` (rebuilt on the new model) |

- The database schema is replaced with a new one. Prototype tables are
  dropped; no prototype data is migrated.
- Pieces that still fit may be carried over rather than rewritten: the
  accounts work, the date helpers, the local/hosted database switch, the CI
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
- **Hosting is Vercel's Neon integration.** Older docs named Supabase; the
  `accounts` epic corrects them, so nothing is left to do here.
- **Allergen matching is by text.** It cannot know that an ingredient with an
  innocent name contains an allergen (for example a bottled sauce). The family
  remains responsible for what they type in; label checking is out of scope.
- **Single family.** One allergy list and one meals list for the whole
  deployment; meals and allergens carry no family or member id.
- **Vercel and Neon free tiers** are assumed to stay sufficient for one
  household. If either changes, cost is revisited before adding a paid plan.
- The eight starting favourites need ingredient lists written as part of the
  seed; these are a reasonable first draft the family can edit, not a recipe.

## Out of Scope

- Week plans, drafting and cook history (`weekly-draft`); nights off
  (`nights-off`).
- A to-try list (`new-meal`).
- Ingredient quantity and unit, and the "needs ingredients" marker
  (`meal-details`).
- Any MCP or assistant access (`assistant-tools`, `mcp-oauth`). Removing the
  prototype's endpoint leaves assistants without access until then; that is
  accepted (stakeholder's decision, 2026-11-11).
- Texts, approval and swaps (`phone-approval`).
- Loved it / Never again ratings and graduation from to-try to favourite
  (`feedback-loop`).
- Grocery lists, aisles, pantry staples and Walmart item ids (`grocery-list`,
  `walmart-pickup`).
- The "try these?" stack, photo capture and link import (`find-new-meals`).
- Recipe steps, cook times, servings, nutrition.
- Accounts, sign-in and family membership (`accounts`); multiple families.
- Growing the list from 8 to 15–20 favourites: that is done by the family
  using these pages, not by this build.

## Dependencies

- `docs/PRODUCT.md` – hard rules, starting favourites and roadmap order. It
  wins where this PRD disagrees.
- The existing Vercel project and its Neon database (`DATABASE_URL`).
- **`accounts` PRD, complete:** sign-in, the signed-in-member check, and
  the family and account pages. `weekly-draft` depends on this PRD in turn.
