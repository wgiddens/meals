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

### Optional settings

Copy `.env.example` to `.env.local` and fill in what you need:

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Turns on "Start from a photo" on the new-recipe page, and lets "Start from a link" read pages that publish no recipe data. |
| `MCP_API_KEY` | Bearer token assistants must send to `/api/mcp`. Unset = open, fine on localhost only. |
| `HOUSEHOLD_TIMEZONE` | What "tonight" means. Default `America/New_York`. |
| `DATABASE_URL` | Use a real Postgres (e.g. Supabase) instead of the embedded one. |

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
"What's left on the grocery list?"

### Tools exposed

| Tool | What it does |
| --- | --- |
| `whats_for_supper` | Tonight's (or any date's) planned supper with timing and complexity |
| `get_meal_plan` | The plan for a run of days (default: this week) |
| `plan_meal` | Set a recipe or a note for a date, or clear it |
| `list_recipes` | Search by text, max minutes, complexity, tag, rating |
| `get_recipe` | Full ingredients and steps |
| `add_recipe` | Save a new recipe |
| `get_grocery_list` | Current list, optionally rebuilt from the plan |
| `add_grocery_item` | Add a non-recipe item (milk, paper towels) |

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

Hosting details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#deployment).
Short version: Vercel + a Supabase Postgres, four environment variables, run
`npm run db:migrate` once. There are no user accounts yet, so keep the
deployment private until that lands (it's the first item under "Next" in the
roadmap).
