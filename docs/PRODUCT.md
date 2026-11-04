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
4. **Low friction to add recipes.** Type one in, or take a picture of a plate
   and let the app draft the ingredients and steps.

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
- Assistant access over MCP: `whats_for_supper`, `get_meal_plan`, `plan_meal`,
  `list_recipes`, `get_recipe`, `add_recipe`, `get_grocery_list`,
  `add_grocery_item`. Works with Claude (desktop, mobile, Code), ChatGPT
  (connectors / developer mode) and Gemini CLI.
- Runs locally with zero setup (embedded Postgres), deploys to Vercel +
  Supabase with two environment variables.

### Next

Roughly in priority order. Items marked *in review* have an open pull request.

- **Accounts and household sharing.** Sign in (Supabase Auth), one household,
  several members. Needed before the app is reachable from the open internet
  with family data in it. Interim step, already in place: a single shared
  household passcode (`HOUSEHOLD_PASSCODE`) gates the web app; see
  ARCHITECTURE.md.
- **Family members and preferences.** Each person in the household is a
  record: who's cooking tonight, who rated what, who won't eat mushrooms.
  Prioritized early because it touches most tables (ratings, notes, plan
  entries, pantry) and is cheaper to design in than to retrofit. If it works
  for one family, inviting friends into their own households is a small step.
- **Import from a URL.** Paste a recipe link; extract ingredients and steps.
  *In review.*
- **Assistant write tools.** Mark cooked, rate, edit a recipe, check off and
  remove list items over MCP, so the assistant can do everything the pages
  can. *In review.*
- **Close the cooking loop.** Today data only flows recipe → plan → list and
  nothing comes back. The `cooked` flag exists but nothing reads it.
  - Rate each cook when marking it cooked ("was it good, would we make it
    again?"); the recipe's rating becomes an average rather than a field
    someone typed once.
  - Per-cook notes ("used less salt", "kids skipped the beans"). The recipe
    notes field is for the recipe; this is for what happened that night.
  - "Last cooked" on every recipe, and sort the plan picker by it. The
    alphabetical dropdown stops working around 40 recipes.
  - History: "when did we last have this?", "what did we eat last month?",
    repeats, and what we haven't had in a while.
- **Let the assistant plan the week.** The MCP tools are primitives; the
  assistant can set Thursday but can't be asked to draft the week.
  - A `suggest_week` tool (or MCP prompt) that takes constraints (time budget
    per weekday, no repeats within N weeks, one new thing, use up the chicken)
    and returns a draft for approval. Mostly prompt work on top of history.
  - **"Try something new."** Suggestions given what we've liked, the time
    budget and what's already on the plan. Save the result as a recipe with
    one tap.
  - **Cook from what's in the house.** Enter the groceries you came home with
    (or what's in the freezer) and get ideas, new or from the book.
  - A small "suggest" UI in the web app so the family gets this without
    opening a chat.
- **Grocery list.**
  - "Already have it" at build time: show the aggregated list before saving
    and tick off what's in the house.
  - Hand the list to the store: per-line "search at Walmart" links, or a
    plain-text export into whatever app the store uses. The cheap step toward
    the pickup order under "Later".
  - Smarter merging: convert between units where it's safe (3 tsp → 1 tbsp),
    and a per-household pantry list so staples like salt aren't added every
    week.
- **Cook mode.** The recipe page while cooking: big steps, screen stays awake,
  tap-to-start timers from "simmer 20 minutes".
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
- Shared shopping in real time (two phones in the store). Check-off is a
  full server round trip today with no live update.
- Copy last week, and recurring slots ("Taco Tuesday", "pizza Friday").
- Leftovers awareness: when servings exceed the family, suggest "leftovers"
  for the next night.
- Add to home screen (PWA manifest). The pages are mobile-first already.
- Photos of the finished dish on recipes, once Supabase Storage is in play.

## Non-goals (for now)

- Nutrition tracking, calorie counts, diets.
- A public recipe community. Households and the friends they invite, not the
  public.
- Replacing the assistant's own intelligence. The app stores facts and exposes
  tools; the assistant does the suggesting and conversation.
