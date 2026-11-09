# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router, Cache Components, TypeScript) | One codebase for the UI, the server actions that write data, and the HTTP endpoints the assistants call. Deploys to Vercel in one step. |
| Styling | Tailwind CSS 4 | Small, mobile-first pages without a component library to maintain. |
| Database | Postgres via Drizzle ORM | Relational data (recipes ↔ ingredients ↔ plan ↔ list). Drizzle gives typed queries and SQL migrations. |
| Local DB | PGlite (embedded Postgres, WASM) | `npm run dev` works with no services installed. Same SQL dialect as production, so no "works on SQLite but not Postgres" surprises. Data lives in `./data/pglite`. |
| Hosted DB | Supabase Postgres (any Postgres works) | Set `DATABASE_URL`. Supabase also offers Auth and Storage if we need them later. |
| AI | Anthropic SDK (`@anthropic-ai/sdk`), Claude Opus 5.5 | Vision + structured output for photo → recipe, and text extraction for URL imports without recipe data. Called server-side only. |
| Assistant integration | MCP over Streamable HTTP (`mcp-handler` + `@modelcontextprotocol/server`) | One endpoint that Claude, ChatGPT and Gemini can all connect to. |

## Layout

```
src/
  db/
    schema.ts        Drizzle tables, enums, relations, inferred types
    index.ts         getDb(): PGlite locally, Postgres when DATABASE_URL is set
    seed.ts          npm run db:seed – a few family recipes
  lib/
    dates.ts         calendar-date helpers in the household timezone
    format.ts        quantity/unit formatting and normalization
    recipes.ts       recipe CRUD + search (used by UI and MCP)
    plan.ts          weekly supper plan
    grocery.ts       aggregate plan ingredients → shopping list
    today.ts         request-time "today" for pages
    ai/draft.ts      the shared recipe-draft schema and the Claude call that fills it
    ai/plate.ts      photo → draft (prompt + image input)
    ai/web.ts        page text → draft (fallback for URL import)
    import/          URL import: fetch guard, JSON-LD mapping, ingredient-line
                     parser + aisle guesser, HTML → text
  app/
    page.tsx         Tonight + this week
    recipes/         list, detail, new, edit
    plan/            week editor
    grocery/         list with check-off and manual items
    actions.ts       Server Actions (all writes from the UI)
    api/mcp/route.ts MCP endpoint for assistants
    api/plate/route.ts  photo upload → recipe draft JSON
    api/import/route.ts URL → recipe draft JSON
  components/        RecipeForm (client), RecipeCard
drizzle/             generated SQL migrations (committed)
scripts/smoke.ts     end-to-end check of the data layer against a temp DB
scripts/check-import.ts  importer checks against scripts/fixtures/import/*.html
docs/                this file and PRODUCT.md
```

Everything the assistants can do goes through the same `src/lib/*` functions
the pages use. The MCP route is a thin adapter: validate arguments with zod,
call the library, return JSON as text.

## Data model

```
recipes ──< recipe_ingredients
   │
   └──< planned_meals (date, meal='supper', recipe_id | note, cooked)

grocery_lists (start_date, end_date) ──< grocery_items
                                          (name, qty, unit, category,
                                           source=plan|manual, for_recipes[], checked)
```

- `recipes.complexity` is an enum (`easy` / `medium` / `hard`) and time is
  `prep_minutes` + `cook_minutes`. Both are filterable because they drive
  weeknight decisions.
- `recipe_ingredients.category` is the grocery aisle; it is what the list is
  grouped by.
- `planned_meals` is unique on `(date, meal)`. Deleting a recipe sets
  `recipe_id` to null rather than deleting the plan entry.
- A grocery list is a materialized snapshot of a plan window. Rebuilding
  regenerates `source='plan'` rows, keeps `source='manual'` rows, and carries
  over `checked` by normalized (name, unit).

Dates are stored as calendar dates (`YYYY-MM-DD`), never timestamps. "Today"
is computed in `HOUSEHOLD_TIMEZONE` so "tonight" means the same thing to the
server and to the family.

## Cache Components (Next.js 16)

The app is built with `cacheComponents: true`. Static shells are prerendered
and anything that reads the database streams in at request time inside a
`<Suspense>` boundary. To make that rule hard to break, `getDb()` awaits
`connection()` when running inside Next, so any DB read is automatically
request-time. Pages that need "today" call `today()` from `src/lib/today.ts`
for the same reason.

## Assistant integration (MCP)

`POST /api/mcp` implements the Model Context Protocol over Streamable HTTP.
Tools are registered with zod input schemas, so each assistant sees typed,
documented functions. Auth is a shared bearer token (`MCP_API_KEY`); the
endpoint also advertises RFC 9728 protected-resource metadata, so moving to
OAuth later is additive. OAuth is on the roadmap (docs/PRODUCT.md), since
ChatGPT's and Claude's connector UIs prefer it.

## Photo → recipe

`POST /api/plate` takes a multipart upload, sends it to Claude with a system
prompt and a zod output schema (`client.messages.parse` +
`zodOutputFormat`), and returns a draft. The draft pre-fills the recipe form;
the cook reviews it before saving. The model's own list of assumptions is
shown above the form.

## Link → recipe

`POST /api/import` takes `{ url }` and returns the same draft shape as the
photo endpoint plus `method` and `sourceUrl`, so `RecipeForm` pre-fills the
same way (with `source` = `web` and the link in Source URL).

1. **Fetch** (`src/lib/import/fetch.ts`). http(s) only; localhost, bare
   hostnames, and private, link-local or loopback addresses are refused, both
   as typed and after DNS resolution and on every redirect hop. 10 second
   timeout, body read capped at 2 MB, browser-like `User-Agent` and
   `Accept: text/html`. `IMPORT_ALLOW_PRIVATE_URLS=true` turns the address
   check off for local testing against a fixture server; never set it on a
   deployment. IPv6 addresses are compared by value, so IPv4-mapped, NAT64
   and 6to4 forms of a private IPv4 address are refused too. DNS rebinding is
   not defended: the hostname is resolved once for the check and again by
   `fetch()`, so a short-TTL record could pass the check and then point at a
   private address; the endpoint relies on the household passcode gate in
   front of `/api/*` instead. Because `POST /api/import` makes outbound
   requests on the caller's behalf and can spend Claude tokens, it must
   always sit behind that gate.
2. **schema.org Recipe from JSON-LD** (`jsonld.ts`). Walks every
   `application/ld+json` block, including `@graph` arrays and array `@type`s.
   Maps name, description, `recipeIngredient`, `recipeInstructions` (strings,
   `HowToStep`, `HowToSection` groups, which keep a heading line), ISO 8601
   durations to minutes (deriving cook time from `totalTime` when needed),
   `recipeYield` to servings, and keywords/category/cuisine to tags. Effort is
   guessed from total time and step count. `image` is ignored for now (no
   image storage). Needs no API key, and is what nearly every recipe site and
   WordPress recipe plugin publishes.
3. **Ingredient lines** (`ingredients.ts`). Leading quantity (decimals, ASCII
   and unicode fractions, mixed numbers, ranges like "1-2" keep the low value
   and note the range), a unit normalized through `format.ts`, the name, and a
   note from parentheses or after the first comma. A keyword map assigns the
   grocery aisle; unknown items are `other`. Anything unreadable becomes a
   name-only line rather than being dropped.
4. **Claude fallback** (`src/lib/ai/web.ts`) when no Recipe node exists and
   `ANTHROPIC_API_KEY` is set: the page is stripped to readable text
   (`html.ts`: no script/style/nav/header/footer, `<main>`/`<article>` when
   present, capped at 40k characters) and sent with a prompt that says to
   extract only what is on the page and never invent quantities. Same model,
   schema and `messages.parse` call as the photo path, via `ai/draft.ts`; the
   model assigns aisles itself.
5. Otherwise the endpoint answers 422 with "no recipe found on that page".

`npm run check:import` exercises steps 2 to 4's parsing against the fixtures
in `scripts/fixtures/import` and the URL guard, with no network.

## Running checks

- `npm run typecheck` – TypeScript
- `npm run lint` – ESLint
- `npm run check:import` – URL importer against fixture pages, no network
- `npm run smoke` – runs `check:import`, then creates a temp PGlite DB and
  walks recipes → plan → list
- `npm run build` – also enforces the Cache Components rules per route
- `node scripts/e2e-import.mjs` – optional browser walk-through of "Start from
  a link" against a running production server (needs Playwright on the module
  path; see the header comment for the env vars)

GitHub Actions runs the same four checks, each as its own step, on every pull
request and on every push to `main` (`.github/workflows/ci.yml`). The workflow
sets no `DATABASE_URL` and no `ANTHROPIC_API_KEY`, so the build's migrate step
is a no-op and everything runs against the embedded database. A new push to a
PR cancels the run it supersedes.

## Deployment

### Branches

- `main` is the production branch. Vercel deploys every push to it.
- Work happens on branches (`feature/...`, `chore/...`), never directly on
  `main`.
- Changes reach `main` through a pull request, and the pull request must have
  a green CI check before it is merged.

### Hosting

1. Create a Supabase project (or any Postgres) and set `DATABASE_URL`.
2. `npm run db:migrate` once per schema change (reads `drizzle/`).
3. Deploy to Vercel with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `MCP_API_KEY`
   and `HOUSEHOLD_TIMEZONE` set.
4. Give the assistants `https://<your-domain>/api/mcp` and the bearer token.

There are no user accounts; a shared household passcode is the planned
protection (pull request #4) and multi-family accounts wait. Until the
passcode lands, keep the deployment private (Vercel password protection or a
private network) or accept that anyone with the URL can see the plan.
