# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router, Cache Components, TypeScript) | One codebase for the UI, the server actions that write data, and the HTTP endpoints the assistants call. Deploys to Vercel in one step. |
| Styling | Tailwind CSS 4 | Small, mobile-first pages without a component library to maintain. |
| Database | Postgres via Drizzle ORM | Relational data (recipes ↔ ingredients ↔ plan ↔ list). Drizzle gives typed queries and SQL migrations. |
| Local DB | PGlite (embedded Postgres, WASM) | `npm run dev` works with no services installed. Same SQL dialect as production, so no "works on SQLite but not Postgres" surprises. Data lives in `./data/pglite`. |
| Hosted DB | Neon Postgres through Vercel's Neon integration (any Postgres works) | The integration sets `DATABASE_URL`; every build applies migrations. Free at family scale. |
| Accounts | Better Auth (`better-auth`), Google sign-in, sessions in our own Postgres via its Drizzle adapter | No extra service, no cost, and the same tables locally and hosted. |
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
    auth.ts          getAuth(): Better Auth (Google, 90-day sessions, the
                     invite-only hooks, the preview OAuth proxy)
    auth-client.ts   Better Auth's browser client (starts Google sign-in)
    gate.ts          gate decisions from the environment: dev owner,
                     sign-in or closed; safe return paths
    member.ts        currentMember(), requireMember(), requireOwner(),
                     the dev owner
    family.ts        family rules: who may sign up, invite, cancel, remove,
                     rename (plain functions over the database)
    mcp-auth.ts      bearer-token check for /api/mcp
    ai/draft.ts      the shared recipe-draft schema and the Claude call that fills it
    ai/plate.ts      photo → draft (prompt + image input)
    ai/web.ts        page text → draft (fallback for URL import)
    import/          URL import: fetch guard, JSON-LD mapping, ingredient-line
                     parser + aisle guesser, HTML → text
  proxy.ts           the sign-in gate: looks the session up on every request,
                     sends signed-out pages to /sign-in, 401s the API
  app/
    page.tsx         Tonight + this week
    recipes/         list, detail, new, edit
    plan/            week editor
    grocery/         list with check-off and manual items
    actions.ts       Server Actions (all writes from the UI)
    sign-in/         "Continue with Google", refusal and not-configured states
    account/         My account: display name, sign out (+ actions.ts)
    family/          members, invitations, owner controls (+ actions.ts)
    api/auth/[...all]/route.ts  Better Auth's endpoints
    api/mcp/route.ts MCP endpoint for assistants
    api/plate/route.ts  photo upload → recipe draft JSON
    api/import/route.ts URL → recipe draft JSON
  components/        RecipeForm, RecipeCard, GoogleSignInButton (client),
                     FamilyControls (client)
drizzle/             generated SQL migrations (committed)
scripts/smoke.ts     end-to-end check of the data layer against a temp DB
scripts/check-import.ts  importer checks against scripts/fixtures/import/*.html
scripts/check-auth.ts    sign-in foundation, the gate and the preview proxy
scripts/check-accounts.ts  the account rules, one section per criterion
scripts/migrate-if-configured.mjs  build step: migrate when DATABASE_URL is set
docs/                this file, DEPLOY.md and PRODUCT.md
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

user (role=owner|member) ──< session, account (Google), invitations.invited_by
family (one row: name)       invitations (name, email, state=pending|accepted|cancelled)
verification                 (Better Auth's short-lived OAuth state)
```

- `recipes.complexity` is an enum (`easy` / `medium` / `hard`) and time is
  `prep_minutes` + `cook_minutes`. Both are filterable because they drive
  weeknight decisions.
- `recipe_ingredients.category` is the grocery aisle; it is what the list is
  grouped by.
- `user`, `session`, `account` and `verification` are Better Auth's tables.
  `user.role` is server-only: no client request can set it. A unique index
  allows at most one owner. There is no family id on any table; a deployment
  is one family.
- `invitations.email` is stored lower-case and unique among pending
  invitations.
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

## Accounts and the sign-in gate

Each family member has a personal account in one invite-only family and
signs in with Google, through Better Auth (`src/lib/auth.ts`). Sessions are
rows in our Postgres, 90 days long and renewed at most once a day while in
use. Email and password sign-in is off.

Settings (all unset locally; values per environment in
[DEPLOY.md](DEPLOY.md#4-vercel-environment-variables)):

| Variable | Role |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs session cookies. Production fails closed without it. |
| `BETTER_AUTH_URL` | The site's public address: sign-in redirects, and the address shown on `/family` after inviting. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Google OAuth client. Both set turns sign-in on. |
| `OWNER_EMAIL` | Who becomes the owner on first sign-in; needed only until then. |
| `OAUTH_PROXY_URL`, `OAUTH_PROXY_SECRET`, `OAUTH_PROXY_PREVIEW_PATTERN` | Google sign-in on Vercel previews only (below). |

### Two layers

- `src/proxy.ts` runs before every request (the Next.js 16 `proxy` file
  convention, formerly `middleware`, on the Node.js runtime). It looks the
  session up in the database, not just whether a cookie is present, so a
  forged cookie, an expired session and a removed member's cookie are all
  turned away. Signed-out page requests go to `/sign-in?next=<path>`; `/api/*`
  requests get a 401. Exempt: `/sign-in`, `/api/auth/*` (Better Auth),
  `/api/mcp` (its own bearer token) and `/.well-known/*`. A renewed session
  cookie is passed on to the browser.
- Server code checks again, independent of the proxy's matcher: every Server
  Action and every API route except `/api/auth` and `/api/mcp` starts with
  `requireMember()` or, for family management, `requireOwner()`
  (`src/lib/member.ts`).

The cookie cache is off, so every check reads the session and the user row
from the database. Removing a member therefore takes effect on their very
next request, and a role is never stale.

### Family rules

Kept in `src/lib/family.ts` as plain functions over the database, so the
checks can run them against a temporary database.

- **Invite only.** Better Auth's before-create database hook is the single
  choke point for new accounts: it refuses any email Google has not verified,
  and any email that is neither `OWNER_EMAIL` (while no owner exists) nor
  has a pending invitation. A refused sign-in writes no row and comes back to
  `/sign-in` with a fixed message.
- **One owner.** `OWNER_EMAIL` counts only while there is no owner, so
  changing it later can never create a second one. It is needed only until
  the owner first signs in. With it unset in production, the owner route is
  closed but invitations keep working.
- **The owner** invites (name and Google email; no email is sent), cancels
  invitations, removes members and renames the family on `/family`. The owner
  cannot be removed. Removing a member deletes their sessions, linked
  accounts and user row, and cancels any pending invitation for their email.
- **No automatic account linking.** A member is tied to the Google account
  (`sub`) they first signed in with. A Google sign-in for the same email but
  a different Google account is refused (`account_not_linked`), so if a
  member's Google account is deleted and re-created, the owner removes and
  re-invites them.
- **Google sign-in only through the redirect flow.** The ID-token route is
  off.

### Local development and production fail-closed

`src/lib/gate.ts` decides the mode from the environment alone:

- **dev-owner**: not production and no Google client configured. Everyone is
  the built-in dev owner, created on first use, so `npm run dev` needs no
  setup. If the database already has an owner, that owner is reused, which
  is why a local dev server must never point at the production database.
- **sign-in**: a Google client is configured (and, in production,
  `BETTER_AUTH_SECRET` too).
- **closed**: production with Google or `BETTER_AUTH_SECRET` missing. Nothing
  is accessible, and `/sign-in` says sign-in isn't set up.

`NODE_ENV === "production"` is checked first, before any sign-in setting is
read, so a production build can never reach the dev owner. In production
`/api/mcp` also refuses every request when `MCP_API_KEY` is unset.

### Google sign-in on Vercel previews

Google only redirects to addresses registered on the OAuth client, and every
preview has a new address. Previews therefore send Google sign-in through one
fixed preview with Better Auth's `oAuthProxy` plugin: Google returns there,
it exchanges the code and hands a sealed profile back to the preview the
sign-in started on, which creates the session in its own database. The roles
(`oauthProxyRole()` in `src/lib/auth.ts`) are decided from `VERCEL_ENV` and
`VERCEL_BRANCH_URL`, never from the request:

- **production** (`VERCEL_ENV=production`): never runs the proxy, ignores
  every `OAUTH_PROXY_*` variable and refuses hand-backs. A production hosted
  outside Vercel has no `VERCEL_ENV`, so it must not set `OAUTH_PROXY_*`.
- **fixed**: the preview whose branch address is `OAUTH_PROXY_URL`. It only
  hands sign-ins back to itself or to previews matching
  `OAUTH_PROXY_PREVIEW_PATTERN`, and refuses hand-backs sent to it.
- **receiver**: every other preview. It accepts a hand-back only in the
  browser that started the sign-in.
- **off**: no `OAUTH_PROXY_URL`, or `OAUTH_PROXY_SECRET` missing or equal to
  `BETTER_AUTH_SECRET`.

Known residuals, accepted for previews only: whoever holds the Preview
`OAUTH_PROXY_SECRET` can forge a hand-back to a preview; and
`OAUTH_PROXY_PREVIEW_PATTERN` could match a preview in another Vercel scope
whose slug ends the same way. Exploiting that still needs the Preview
`OAUTH_PROXY_SECRET` and exposes at most a preview user's basic Google
profile, never a production sign-in. Setup is in [DEPLOY.md](DEPLOY.md).

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
   private address; the endpoint relies on the sign-in gate in front of
   `/api/*` instead. Because `POST /api/import` makes outbound
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
- `npm run check:auth` – the sign-in foundation, the proxy gate and the
  preview OAuth proxy, on a temp PGlite DB
- `npm run check:accounts` – the account rules, on a temp PGlite DB
- `npm run smoke` – runs `check:import`, `check:auth` and `check:accounts`,
  then creates a temp PGlite DB and walks recipes → plan → list
- `npm run build` – also enforces the Cache Components rules per route
- `node scripts/e2e-import.mjs` – optional browser walk-through of "Start from
  a link" against a running production server (needs Playwright on the module
  path; see the header comment for the env vars)

GitHub Actions runs the same four checks, each as its own step, on every pull
request and on every push to `main` (`.github/workflows/ci.yml`). The workflow
sets no `DATABASE_URL`, no `ANTHROPIC_API_KEY` and no sign-in secrets, so the build's migrate step
is a no-op and everything runs against the embedded database. A new push to a
PR cancels the run it supersedes.

## Deployment

### Branches

- `main` is the production branch. Vercel deploys every push to it.
- Work happens on branches (`feature/...`, `chore/...`), never directly on
  `main`.
- Changes reach `main` through a pull request, and the pull request must have
  a green CI check before it is merged.
- Once the accounts epic has merged, a long-lived `auth-proxy` branch tracks
  `main`: its preview is the fixed preview that every preview's Google
  sign-in goes through. It is fast-forwarded after each merge to `main` and
  never committed to directly ([DEPLOY.md](DEPLOY.md#3-the-fixed-preview-oauth-proxy)).

### Hosting

Vercel, with its Neon Postgres integration for `DATABASE_URL`. The build
(`scripts/migrate-if-configured.mjs`) applies migrations whenever
`DATABASE_URL` is set, so every deployment, previews included, migrates the
database it points at. Production and previews are fully separate: their own
databases, Google OAuth clients and secrets.

The one-time setup checklist and the hand check (production and a preview)
are in [DEPLOY.md](DEPLOY.md).
