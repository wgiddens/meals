# Meals

Our family's recipe book, weekly supper plan, and grocery list. Also the thing
Claude, ChatGPT or Gemini looks at when you ask "what's for supper tonight?"

- **Recipes** with time, complexity, a family rating, tags, ingredients by aisle.
- **Plan** supper for each night of the week. A recipe, or just "leftovers".
- **Groceries** built from the plan, combined across recipes, grouped by aisle,
  checkable on a phone in the store.
- **Link → recipe**: paste a recipe URL, get a draft to review and save.
  Works offline from the site's own recipe data; Claude reads pages that
  have none.
- **Photo → recipe**: snap a plate, get a draft ingredient list and steps.
- **Assistant access** over MCP so any AI chat can read and update the plan.

Where it's heading: a dinner plan drafted for us every Saturday, approved on
Shannon's phone in a few taps, and one Walmart pickup for the groceries.
Product vision and roadmap: [docs/PRODUCT.md](docs/PRODUCT.md).
How it's built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it locally

Requires Node 20+.

```bash
npm install
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:3000. No database to install: locally the app runs an
embedded Postgres (PGlite) stored in `./data/pglite`. The seed step adds a few
starter recipes; skip it if you'd rather start empty.

No sign-in either: with no Google client configured, you are the built-in
**dev owner** (see [Accounts](#accounts)). Never point a local dev server at
the production database: the dev owner reuses whoever already owns that
database, so anyone who can reach your dev server would act as the family's
owner.

### Optional settings

Copy `.env.example` to `.env.local` and fill in what you need:

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Turns on "Start from a photo" on the new-recipe page, and lets "Start from a link" read pages that publish no recipe data. |
| `MCP_API_KEY` | Bearer token assistants must send to `/api/mcp`. Unset = open locally; production refuses every request without it. |
| `HOUSEHOLD_TIMEZONE` | What "tonight" means. Default `America/New_York`. |
| `DATABASE_URL` | Use a real Postgres instead of the embedded one. Hosted, this is Neon through Vercel's Neon integration. |

Sign-in settings. Leave them all unset locally; set them on every deployment
(see [docs/DEPLOY.md](docs/DEPLOY.md)):

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs session cookies. Required on a deployment; generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | The site's public address, for sign-in redirects and the address shown after inviting someone. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Google OAuth client. Setting both turns sign-in on. |
| `OWNER_EMAIL` | The Google account that becomes the family's owner on its first sign-in. Needed only until then. |
| `OAUTH_PROXY_URL`, `OAUTH_PROXY_SECRET`, `OAUTH_PROXY_PREVIEW_PATTERN` | Google sign-in on Vercel previews only. Never on production. See `.env.example`. |

## Accounts

Everyone in the family has their own account and signs in with **Google**.
There is one family per deployment, and it is invite only.

- **The owner** is the Google account whose email is `OWNER_EMAIL`, on its
  first sign-in. There is exactly one owner, and only while there is none
  does `OWNER_EMAIL` count; with it unset in production nobody can become the
  owner, but invitations keep working.
- **Members** are invited by the owner on the **Family** page (name and the
  email of their Google account). No email is sent: pass on the app's address
  shown after inviting. They sign in with that Google account.
- **Everyone else** is refused: a Google account that is not the owner email
  and has no pending invitation, or whose email Google hasn't verified,
  cannot create an account.
- **The owner removes members** on the Family page. A removed member is
  signed out on their next request.
- **No automatic account linking.** A member is tied to the Google account
  they first signed in with. If that Google account is deleted and
  re-created, sign-in is refused until the owner removes and re-invites them.
- **Sessions last 90 days** and are renewed while in use, so a phone stays
  signed in. **My account** changes your display name and signs you out.

Two layers check every request: `src/proxy.ts` looks the session up before
any page or API route (signed-out pages go to `/sign-in`, API calls get a
401), and every Server Action and API route checks again on the server.

Locally, with no Google client configured, you are the built-in **dev
owner** and nothing asks you to sign in. In production that shortcut is
unreachable, and if the sign-in settings are incomplete the app **fails
closed**: nothing is accessible and `/sign-in` says sign-in isn't set up.

## Connect an AI assistant

The app exposes an MCP server at `/api/mcp`. Run the app somewhere the
assistant can reach (for a quick test on your own machine, `npm run dev` plus
a tunnel such as `ngrok http 3000` works). Set `MCP_API_KEY` and use that
value as the bearer token.

**Claude (claude.ai / desktop / mobile):** Settings → Connectors → Add custom
connector. URL: `https://<host>/api/mcp`. If the connector UI asks for OAuth,
use Claude Code or the config below instead for now.

**Claude Code:**

```bash
claude mcp add --transport http meals https://<host>/api/mcp --header "Authorization: Bearer <MCP_API_KEY>"
```

**ChatGPT:** Settings → Connectors → Create (requires developer mode) with the
same URL. ChatGPT's connector UI prefers OAuth; a shared token works through
developer mode today, and OAuth is on the roadmap.

**Gemini CLI** (`~/.gemini/settings.json`):

```json
{
  "mcpServers": {
    "meals": {
      "httpUrl": "https://<host>/api/mcp",
      "headers": { "Authorization": "Bearer <MCP_API_KEY>" }
    }
  }
}
```

**Anything stdio-only:** `npx -y mcp-remote https://<host>/api/mcp --header "Authorization: Bearer <MCP_API_KEY>"`.

Once connected, try: "What's for supper tonight?", "What could we make in
under 30 minutes that the kids like?", "Put sheet pan fajitas on Thursday",
"We had it, it was a 4", "Cross milk off the list", "What's left on the
grocery list?"

### Tools exposed

| Tool | What it does |
| --- | --- |
| `whats_for_supper` | Tonight's (or any date's) planned supper with timing and complexity |
| `get_meal_plan` | The plan for a run of days (default: this week) |
| `plan_meal` | Set a recipe or a note for a date, or clear it |
| `mark_cooked` | Record that a date's supper was cooked ("we had it"), or undo it |
| `list_recipes` | Search by text, max minutes, complexity, tag, rating |
| `get_recipe` | Full ingredients and steps |
| `add_recipe` | Save a new recipe |
| `rate_recipe` | Family rating 1–5 after eating, with an optional note appended |
| `update_recipe` | Edit any recipe fields; optionally replace the ingredient list |
| `get_grocery_list` | Current list, optionally rebuilt from the plan |
| `add_grocery_item` | Add a non-recipe item (milk, paper towels) |
| `check_grocery_item` | Tick an item off (or back on) by id or name; returns what's left |
| `remove_grocery_item` | Take an item off the list by id or name |

Tools that change data and take an id *or* a name/title (`plan_meal`,
`rate_recipe`, `update_recipe`, `check_grocery_item`, `remove_grocery_item`)
resolve a case-insensitive exact match first, then a partial match. If several
recipes or items match, the tool returns an error listing the candidates with
their ids rather than guessing. The read-only `get_recipe` returns the best
match. `rate_recipe` takes a rating, a note, or both.
There is deliberately no delete-recipe tool; deleting is a website action.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run smoke` | Runs `check:import`, then an end-to-end check of the data layer on a throwaway database |
| `npm run check:import` | Checks the URL importer against the fixture pages in `scripts/fixtures/import` (no network, no API key) |
| `npm run db:seed` | Add starter recipes |
| `npm run db:generate` | Generate a SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (embedded DB migrates itself) |
| `npm run db:studio` | Browse the database |

## Contributing and deploying

`main` is the production branch: every push to it deploys to Vercel. Work on
a branch and open a pull request into `main`. CI (GitHub Actions) runs
typecheck, lint, smoke and build on every pull request, and the check must be
green before the PR is merged.

Hosting and the one-time setup (Google OAuth clients, Vercel variables, a
separate Preview database) are in [docs/DEPLOY.md](docs/DEPLOY.md). Short
version: Vercel with its Neon Postgres integration; every build applies the
database migrations; production and previews use separate Google clients,
secrets and databases. Family members use production and sign in with
Google. Assistants are unaffected: `/api/mcp` keeps using its own
`MCP_API_KEY` bearer token.
