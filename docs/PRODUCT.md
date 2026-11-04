# Meals – product vision

A recipe book and supper planner for one family. It stores the recipes we
actually cook, helps us rough out the week, writes the grocery list for us,
and answers "what's for supper tonight?" from whichever AI assistant we happen
to have open.

## Who it's for and when it's used

- **The family**, on phones in the kitchen and at the store, and on a laptop on
  Sunday when the week gets planned.
- **The cook on a weeknight.** Supper is the meal that matters. We eat it
  together every night, so the plan is about one meal a day, seven days a week.
- **Whoever is shopping.** One list, grouped by aisle, that survives being
  built, rebuilt, and checked off on the go.
- **An AI assistant** (Claude, ChatGPT, Gemini) that any of us can ask "what's
  for supper?", "what could we make in 30 minutes?", or "put tacos on Thursday".

## What matters when we plan

1. **Time and complexity.** How long a recipe takes and how much attention it
   needs are first-class fields, not afterthoughts. A 25-minute "easy" meal and
   a 90-minute "involved" meal are different tools for different nights.
2. **Whether everyone will eat it.** A family rating (1–5) on every recipe. The
   planner and the assistant both lean toward things we've enjoyed.
3. **A rough plan is good enough.** The plan exists mostly so the grocery list
   writes itself. "Leftovers" or "pizza night" are valid entries.
4. **Low friction to add recipes.** Type one in, paste a link, or take a
   picture of a plate and let the app draft the ingredients and steps.

## Roadmap

### Now (this repo, first cut)

- Recipe book: title, description, prep/cook time, complexity, family rating,
  tags, ingredients with quantities and store aisle, steps, notes, source.
- Weekly supper plan (Sunday–Saturday), one slot per day, recipe or free text,
  "mark as cooked".
- Grocery list built from any plan window. Ingredients across recipes are
  combined by name and unit, grouped by aisle. Checked-off state and
  hand-added items survive a rebuild.
- Photo → recipe draft: upload a picture of a plate, get a title, ingredient
  list, timing and steps to review before saving.
- Import from a URL: paste a recipe link, get the same draft to review before
  saving. Reads the recipe data most sites publish (no API key needed); for
  pages without it, Claude drafts from the page text. The saved recipe keeps
  the link as its source.
- Assistant access over MCP: `whats_for_supper`, `get_meal_plan`, `plan_meal`,
  `list_recipes`, `get_recipe`, `add_recipe`, `get_grocery_list`,
  `add_grocery_item`. Works with Claude (desktop, mobile, Code), ChatGPT
  (connectors / developer mode) and Gemini CLI.
- Runs locally with zero setup (embedded Postgres), deploys to Vercel +
  Supabase with two environment variables.

### Next

- **Accounts and household sharing.** Sign in (Supabase Auth), one household,
  several members. Needed before the app is reachable from the open internet
  with family data in it.
- **"Try something new."** Ask for suggestions given what we have, what we've
  liked, the time budget, and what's already on this week's plan. Save the
  result as a recipe with one tap. This is mostly prompt work on top of the
  existing MCP tools plus a small "suggest" UI.
- **Cook from what's in the house.** Enter the groceries you came home with
  and get recipe ideas (new or from the book) that use them.
- **Smarter list merging.** Convert between units where it's safe (3 tsp →
  1 tbsp), and a per-household pantry list so staples like salt aren't added
  every week.
- **History.** "When did we last have this?" and "what did we eat last month?",
  driven by the cooked flag.
- **Scaling.** Adjust servings and scale ingredient quantities.

### Later

- **Walmart pickup order.** Turn the grocery list into a cart for store pickup.
  Walmart's public affiliate API supports product search but not cart or
  checkout, so this likely needs the Walmart Marketplace/IO partner APIs or a
  browser automation step. Design the grocery item model so each line can be
  matched to a store product id when the time comes.
- Multiple meals per day (lunches, breakfasts) if we ever want them. The
  schema already has a `meal` column, so this is UI work.
- Push a reminder: "tonight's supper takes 90 minutes, start by 5".
- Shared shopping in real time (two phones in the store).

## Non-goals (for now)

- Nutrition tracking, calorie counts, diets.
- A public recipe community. This is for one household.
- Replacing the assistant's own intelligence. The app stores facts and exposes
  tools; the assistant does the suggesting and conversation.
