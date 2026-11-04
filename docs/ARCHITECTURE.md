# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router, Cache Components, TypeScript) | One codebase for the UI, the server actions that write data, and the HTTP endpoints the assistants call. Deploys to Vercel in one step. |
| Styling | Tailwind CSS 4 | Small, mobile-first pages without a component library to maintain. |
| Database | Postgres via Drizzle ORM | Relational data (recipes ↔ ingredients ↔ plan ↔ list). Drizzle gives typed queries and SQL migrations. |
| Local DB | PGlite (embedded Postgres, WASM) | `npm run dev` works with no services installed. Same SQL dialect as production, so no "works on SQLite but not Postgres" surprises. Data lives in `./data/pglite`. |
| Hosted DB | Supabase Postgres (any Postgres works) | Set `DATABASE_URL`. Supabase also gives us Auth and Storage for the "Next" roadmap items. |
| AI | Anthropic SDK (`@anthropic-ai/sdk`), Claude Opus 5.5 | Vision + structured output for photo → recipe. Called server-side only. |
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
    household.ts     passcode check + signed session cookie (the gate)
    ai/plate.ts      Claude call: photo → structured recipe draft
  proxy.ts           request interception: sends signed-out requests to /login
  app/
    page.tsx         Tonight + this week
    recipes/         list, detail, new, edit
    plan/            week editor
    grocery/         list with check-off and manual items
    actions.ts       Server Actions (all writes from the UI)
    auth-actions.ts  sign in / sign out for the passcode gate
    login/           the passcode page
    api/mcp/route.ts MCP endpoint for assistants
    api/plate/route.ts  photo upload → recipe draft JSON
  components/        RecipeForm, LoginForm (client), RecipeCard, SignOutLink
drizzle/             generated SQL migrations (committed)
scripts/smoke.ts     end-to-end check of the data layer against a temp DB
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
OAuth later is additive. Expect to add OAuth before sharing the URL beyond
the household, since ChatGPT's connector UI prefers it.

## Household passcode gate

Until real accounts exist, one shared passcode keeps the web app to the
family. `HOUSEHOLD_PASSCODE` turns it on; when it is unset the app is open,
so `npm run dev` needs no setup.

- `src/proxy.ts` runs before every request (the Next.js 16 `proxy` file
  convention, formerly `middleware`). Without a valid session cookie, page
  requests are redirected to `/login?next=<path>` and `/api/*` requests get a
  401. `/login`, `/api/mcp`, Next static assets and the favicon are exempt.
- `/login` posts to `signInAction`, which compares the passcode in constant
  time and sets an HttpOnly, SameSite=Lax cookie (Secure in production) that
  lasts a year. The cookie holds `<issued-at>.<HMAC-SHA256>`; the signing key
  is derived from the passcode, so there is no second secret and rotating the
  passcode signs every device out. A footer link clears the cookie.
- Server Actions are plain POSTs, so each one in `src/app/actions.ts` calls
  `requireHousehold()` rather than trusting the proxy alone.
- `/api/mcp` is deliberately outside the gate: assistants authenticate with
  `MCP_API_KEY` as before.

## Photo → recipe

`POST /api/plate` takes a multipart upload, sends it to Claude with a system
prompt and a zod output schema (`client.messages.parse` +
`zodOutputFormat`), and returns a draft. The draft pre-fills the recipe form;
the cook reviews it before saving. The model's own list of assumptions is
shown above the form.

## Running checks

- `npm run typecheck` – TypeScript
- `npm run lint` – ESLint
- `npm run smoke` – creates a temp PGlite DB and walks recipes → plan → list
- `npm run build` – also enforces the Cache Components rules per route

## Deployment

1. Create a Supabase project (or any Postgres) and set `DATABASE_URL`.
2. `npm run db:migrate` once per schema change (reads `drizzle/`).
3. Deploy to Vercel with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `MCP_API_KEY`,
   `HOUSEHOLD_PASSCODE` and `HOUSEHOLD_TIMEZONE` set.
4. Give the assistants `https://<your-domain>/api/mcp` and the bearer token.
5. Give the family the URL and the passcode. Each phone enters it once.

The passcode is the interim access control until accounts land (first item
under "Next" in the roadmap). Without it, anyone with the URL can read and
change the plan.
