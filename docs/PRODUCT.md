# Family Meals – product vision

Nobody in the house has to plan dinner. Each week a dinner plan simply shows
up, Shannon approves it in a few taps, and the groceries for it arrive in one
Walmart pickup. Less chaos, fewer last-minute meals out, no more "what's for
dinner" at 5 o'clock.

The job of this product is not to help us plan. It is to take planning off our
plate entirely.

This document is the source of truth for what we build and in what order.
Where the code or other docs disagree with it, this document wins.

## Who it's for

- **Now:** Will and Shannon, a family of four (two daughters).
- **Primary approver: Shannon.** Her yes is the one that matters, so
  everything is designed around instant, low-effort approval. Will also
  receives the plan.
- **An AI assistant** (Claude, ChatGPT, Gemini) that either of us can ask to
  read or change the plan, over MCP.
- **Later (not built for yet):** multiple families, as a real product.

## Success measures

- A plan arrives every week without anyone starting it.
- Shannon approves the week in under two minutes, with two swaps or fewer.
- One weekly Walmart pickup replaces most small grocery trips.
- Fewer dinners out because nothing was planned.

## What matters when we plan

### Hard rules

- **Allergies are absolute filters, not preferences.** Peanuts are excluded
  from every meal and every grocery item. The allergy list must be easy to
  extend.
- **Wednesday is church night.** The plan always uses a really quick dinner,
  like a bagged pasta meal, or plans to pick something up. No make-ahead
  meals; they don't work for our family.
- **Time and energy matter more than variety on busy nights.**

### Design principles

- **React, don't recall.** Never ask "what do you want to eat?" from a blank
  slate. The app suggests meals and we tap yes, no, or maybe sometime.
- **Near-zero maintenance.** Adding a meal must take seconds, such as snapping
  a photo of dinner and letting the app work out what it was. If entering
  meals feels like work, the app won't get used.

### Lessons from HelloFresh

We used HelloFresh for a while. The parts we liked are the core of this app;
the parts that failed are what it must avoid.

- **Kept:** being offered choices, so we had a plan, and being nudged to try
  meals we'd never cook on our own.
- **Avoided: cost.** Ingredients come from our regular Walmart shop, not meal
  kits.
- **Avoided: long prep.** Every suggestion, especially new ones, must fit our
  weeknight time: about 30 minutes is the target, 45 to 60 minutes only
  occasionally.

### Scope

- **Dinners are planned.**
- **Breakfasts and school lunches are staples** that are restocked
  automatically, not planned: Pop-Tarts, cereal, oatmeal, microwave pasta
  cups, grapes.

## How it reaches us

- Nobody plans on Sunday. A draft arrives **Saturday afternoon** by default,
  close to the Walmart pickup. Delivery day and time are configurable.
- A **text to Shannon's and Will's phones** with a link to a simple mobile web
  page.
- The page shows the week's dinners with **Approve** and **Swap** on each,
  then later **Loved it / Never again** ratings.
- Swaps come from the favourites list by default, with at most one new idea a
  week, clearly marked as new.
- No native app for now; revisit if this becomes a product.

## How new meals get in

Coming up with new meals ourselves is the barrier, so the app brings them to
us. Every new meal is about 30 minutes and peanut-free.

1. **One new meal in every weekly plan**, picked to resemble what we already
   like (we love Alfredo, so try a quick carbonara), clearly marked as new.
2. **A "try these?" stack** of suggestions to swipe through anytime, such as
   waiting in the pickup line. Yes adds a meal to the try list.
3. **Capture from anywhere:** snap a photo of a meal we enjoyed, or share a
   recipe link or video, and the app works out the dish.
4. **Graduation:** after we try a new meal, "loved it" moves it onto the
   favourites list automatically.

### Starting favourites

Eight dinners to seed the favourites list. The app's suggestions grow the list
from here.

1. Hamburgers
2. Lasagna
3. Shannon's barbecue chicken
4. Alfredo
5. Chicken and gnocchi soup
6. Tacos
7. Breakfast-for-dinner: pancakes or waffles (quick)
8. Steak on the grill

## Roadmap

### Already in the repo

Built in the first scaffold, before this vision. It is the foundation the
milestones below build on.

- Recipe book with prep/cook time, complexity, family rating, tags,
  ingredients with quantities and store aisle, steps, notes, source.
- A weekly plan, one dinner slot per day, recipe or free text, "mark as
  cooked".
- Grocery list built from a plan window, combined across recipes, grouped by
  aisle. Checked-off state and hand-added items survive a rebuild.
- Photo → recipe draft.
- Assistant access over MCP, read and write: `whats_for_supper`,
  `get_meal_plan`, `plan_meal`, `mark_cooked`, `list_recipes`, `get_recipe`,
  `add_recipe`, `rate_recipe`, `update_recipe`, `get_grocery_list`,
  `add_grocery_item`, `check_grocery_item`, `remove_grocery_item`. Enough to
  run the plan from a chat: "what's for supper?", "we had it, it was a 4",
  "cross milk off the list". No delete-recipe tool on purpose.
- Runs locally with zero setup (embedded Postgres); deploys to Vercel +
  Supabase.

Open pull requests that fit this roadmap: the household passcode (#4) and
import from a recipe link (#2).

### Next

In priority order. The weekly draft, phone approval and the cooking feedback
loop come first; groceries and Walmart follow once a plan reliably gets
approved.

1. **Weekly draft (`suggest_week`).** A scheduled task drafts the week's
   dinners and saves the plan, ready by Saturday afternoon.
   - Seed the favourites list first: the eight starting favourites, growing
     to 15–20 dinners the family already likes, each tagged with prep effort
     (quick, normal, or pick-up) and checked against the allergy list.
   - Respects the hard rules: allergy filter, Wednesday is quick or pick-up,
     about 30 minutes on busy nights.
   - Uses "last cooked" history so nothing repeats within a few weeks.
   - Includes one new meal, clearly marked, that resembles what we already
     like.
   - Exposed as an MCP tool too, so any assistant can draft or redraft the
     week.
2. **Approve on the phone.** Shannon and Will get a text with a link. The
   mobile page shows each dinner with Approve and Swap; swaps come from
   favourites. Shannon's approval locks the plan. A shared household passcode
   is enough to protect the page for now (PR #4).
3. **Cooking feedback loop.** After meals, quick Loved it / Never again
   ratings feed future plans so suggestions improve week over week.
   - Each cook is rated; the recipe's family rating is the average of those
     cooks rather than a number typed once.
   - "Last cooked" on every recipe, and history of what we ate.
   - "Loved it" graduates a new meal to favourites; "never again" keeps it out
     of future drafts.
4. **Grocery list.** The approved plan plus weekly staples becomes one
   consolidated list, grouped by aisle. Breakfast and lunch staples live on a
   pantry list and restock automatically.
5. **Walmart pickup.** The list fills our Walmart cart; we just check out.
   Walmart can't place the order for us. **Open question, nothing built yet:**
   see [Walmart pickup](#walmart-pickup) below. Design grocery items so each
   line can later be matched to a Walmart item id.
6. **Find new meals.** The "try these?" swipe stack, and capture from anywhere
   (photo, recipe link or video). Builds on the existing photo → recipe and
   import-from-link work.
7. **OAuth for assistant access.** Sign in to the MCP endpoint with OAuth
   instead of a shared bearer token, so assistants whose connector UI expects
   OAuth (ChatGPT, Claude's custom connectors) connect without developer
   mode. This is for assistant access only; it doesn't bring multi-family
   accounts forward.

### Later

- Cook mode: the recipe page while cooking.
- Scaling servings.
- Recurring slots, like taco night.

## Not now

- Recipes and step-by-step cooking.
- Nutrition tracking.
- Multi-family accounts. A household passcode is enough until then.

## Open questions

- **Allergies beyond peanuts?** Any other allergies or hard no's? For now
  peanuts only; the list stays easy to extend.
- <a id="walmart-pickup"></a>**Walmart pickup: can we fill a cart, and can a
  personal project get access?** Don't build anything for this until it is
  answered. What we found on Walmart I/O (checked 2026-11-09, not yet tried):
  - Walmart's Add To Cart service for partners is a link, not a server-side
    order: `https://www.walmart.com/sc/cart/addToCart?items=<itemId>_<qty>,...&storeId=<storeId>`.
    Opening it in a signed-in browser adds several items, with quantities and
    a pickup store, to that shopper's own cart. Checkout stays with us.
  - The docs say it works for partners whether or not they are onboarded to
    Impact Radius (Walmart's affiliate network).
  - The link needs Walmart item ids for each grocery line, and a store id from
    the store locator. Those come from the Online Pickup and Delivery catalog,
    pricing and store APIs, which need partner onboarding and OAuth keys.
  - Still unknown: whether that onboarding is open to a personal project, and
    whether the cart link works for a household that isn't a registered
    partner. Next step is to try one hand-built cart link with a few real item
    ids and ask Walmart I/O about onboarding.
