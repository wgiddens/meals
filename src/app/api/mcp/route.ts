import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { complexities, ingredientCategories } from "@/db/schema";
import { addDays, isIsoDate, todayIso, weekStart } from "@/lib/dates";
import {
  addManualItem,
  buildListFromPlan,
  getCurrentList,
  listToJson,
} from "@/lib/grocery";
import { describeMeal, getPlan, getSupper, planToJson, setMeal } from "@/lib/plan";
import {
  createRecipe,
  findRecipeByTitle,
  getRecipe,
  listRecipes,
  summarizeRecipe,
} from "@/lib/recipes";
import { formatIngredient } from "@/lib/format";

/**
 * The assistant-facing API. Claude, ChatGPT, Gemini and anything else that
 * speaks MCP (Model Context Protocol) connects here and can answer "what's
 * for supper tonight?", look up recipes, plan meals and read the grocery list.
 *
 * Mounted at /api/mcp (Streamable HTTP). See README for client setup.
 */

const dateArg = z
  .string()
  .optional()
  .describe("Calendar date as YYYY-MM-DD in the household timezone. Defaults to today.");

function resolveDate(input: string | undefined): string {
  if (!input) return todayIso();
  const lower = input.trim().toLowerCase();
  if (lower === "today" || lower === "tonight") return todayIso();
  if (lower === "tomorrow") return addDays(todayIso(), 1);
  if (lower === "yesterday") return addDays(todayIso(), -1);
  if (!isIsoDate(input)) throw new Error(`Invalid date "${input}", expected YYYY-MM-DD`);
  return input;
}

function text(value: unknown) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: body }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "whats_for_supper",
      {
        title: "What's for supper?",
        description:
          "What the family is having for supper on a given day (default: tonight). Returns the planned recipe with timing and complexity, or says nothing is planned.",
        inputSchema: z.object({ date: dateArg }),
      },
      async ({ date }) => {
        try {
          const iso = resolveDate(date);
          const meal = await getSupper(iso);
          const summary = describeMeal({ date: iso, meal });
          return text({
            date: iso,
            summary,
            recipe: meal?.recipe
              ? {
                  ...summarizeRecipe(meal.recipe),
                  ingredients: meal.recipe.ingredients.map(formatIngredient),
                  instructions: meal.recipe.instructions,
                }
              : null,
            note: meal?.note ?? null,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      "get_meal_plan",
      {
        title: "Get meal plan",
        description:
          "The supper plan for a run of days. Defaults to the current week (Sunday to Saturday).",
        inputSchema: z.object({
          start_date: z
            .string()
            .optional()
            .describe("First day, YYYY-MM-DD. Defaults to the Sunday of the current week."),
          days: z.number().int().min(1).max(31).optional().describe("How many days. Default 7."),
        }),
      },
      async ({ start_date, days }) => {
        try {
          const start = start_date ? resolveDate(start_date) : weekStart(todayIso());
          const plan = await getPlan(start, days ?? 7);
          const today = todayIso();
          return text({
            today,
            days: planToJson(plan),
            summary: plan.map((d) => describeMeal(d, today)),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      "plan_meal",
      {
        title: "Plan a meal",
        description:
          "Set what's for supper on a date. Give a recipe_id or recipe_title to plan a recipe from the book, or a note like 'leftovers' or 'pizza night'. Omit both to clear the day.",
        inputSchema: z.object({
          date: dateArg,
          recipe_id: z.string().optional(),
          recipe_title: z.string().optional().describe("Fuzzy-matched against recipe titles"),
          note: z.string().optional(),
        }),
      },
      async ({ date, recipe_id, recipe_title, note }) => {
        try {
          const iso = resolveDate(date);
          let recipeId: string | null = null;
          if (recipe_id) {
            const r = await getRecipe(recipe_id);
            if (!r) throw new Error(`No recipe with id ${recipe_id}`);
            recipeId = r.id;
          } else if (recipe_title) {
            const r = await findRecipeByTitle(recipe_title);
            if (!r) throw new Error(`No recipe matching "${recipe_title}". Use list_recipes to search.`);
            recipeId = r.id;
          }
          const meal = await setMeal({ date: iso, recipeId, note: note ?? null });
          return text({ ok: true, date: iso, summary: describeMeal({ date: iso, meal }) });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      "list_recipes",
      {
        title: "List recipes",
        description:
          "Search the family recipe book. All filters optional. Good for 'what could we make that takes under 30 minutes?'",
        inputSchema: z.object({
          query: z.string().optional().describe("Matches title, description, ingredients and tags"),
          max_minutes: z.number().int().positive().optional().describe("Total prep + cook time limit"),
          complexity: z.enum(complexities).optional(),
          tag: z.string().optional(),
          min_rating: z.number().int().min(1).max(5).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }),
      },
      async (args) => {
        try {
          const rows = await listRecipes({
            query: args.query,
            maxMinutes: args.max_minutes,
            complexity: args.complexity,
            tag: args.tag,
            minRating: args.min_rating,
            limit: args.limit ?? 50,
          });
          return text({ count: rows.length, recipes: rows.map(summarizeRecipe) });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      "get_recipe",
      {
        title: "Get recipe",
        description: "Full recipe with ingredients and instructions, by id or title.",
        inputSchema: z.object({
          recipe_id: z.string().optional(),
          title: z.string().optional(),
        }),
      },
      async ({ recipe_id, title }) => {
        try {
          const recipe = recipe_id
            ? await getRecipe(recipe_id)
            : title
              ? await findRecipeByTitle(title)
              : null;
          if (!recipe) return errorResult(new Error("Recipe not found. Provide recipe_id or title."));
          return text({
            ...summarizeRecipe(recipe),
            source_url: recipe.sourceUrl,
            ingredients: recipe.ingredients.map((i) => ({
              text: formatIngredient(i),
              name: i.name,
              quantity: i.quantity == null ? null : Number(i.quantity),
              unit: i.unit,
              note: i.note,
              category: i.category,
            })),
            instructions: recipe.instructions,
            notes: recipe.notes,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      "add_recipe",
      {
        title: "Add recipe",
        description:
          "Save a new recipe to the family book. Include every ingredient so grocery lists are complete.",
        inputSchema: z.object({
          title: z.string(),
          description: z.string().optional(),
          source_url: z.string().optional(),
          servings: z.number().int().positive().optional(),
          prep_minutes: z.number().int().nonnegative().optional(),
          cook_minutes: z.number().int().nonnegative().optional(),
          complexity: z.enum(complexities).optional(),
          tags: z.array(z.string()).optional(),
          ingredients: z.array(
            z.object({
              name: z.string(),
              quantity: z.number().nonnegative().nullable().optional(),
              unit: z.string().nullable().optional(),
              note: z.string().nullable().optional(),
              category: z.enum(ingredientCategories).optional(),
            }),
          ),
          instructions: z.string().optional().describe("Numbered steps, one per line"),
          notes: z.string().optional(),
        }),
      },
      async (args) => {
        try {
          const recipe = await createRecipe({
            title: args.title,
            description: args.description,
            sourceUrl: args.source_url,
            source: "ai",
            servings: args.servings,
            prepMinutes: args.prep_minutes,
            cookMinutes: args.cook_minutes,
            complexity: args.complexity ?? "medium",
            tags: args.tags ?? [],
            ingredients: args.ingredients,
            instructions: args.instructions,
            notes: args.notes,
          });
          return text({ ok: true, recipe: summarizeRecipe(recipe) });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      "get_grocery_list",
      {
        title: "Get grocery list",
        description:
          "The current shopping list, grouped by store section, with checked-off state. Set rebuild=true to regenerate it from this week's plan first.",
        inputSchema: z.object({
          rebuild: z.boolean().optional(),
          start_date: z.string().optional().describe("With rebuild: first day of the plan window (YYYY-MM-DD)"),
          end_date: z.string().optional().describe("With rebuild: last day of the plan window (YYYY-MM-DD)"),
        }),
      },
      async ({ rebuild, start_date, end_date }) => {
        try {
          let list = rebuild
            ? await buildListFromPlan(
                start_date ? resolveDate(start_date) : undefined,
                end_date ? resolveDate(end_date) : undefined,
              )
            : await getCurrentList();
          if (!list) list = await buildListFromPlan();
          const json = listToJson(list)!;
          const remaining = json.items.filter((i) => !i.checked);
          return text({
            ...json,
            remaining_count: remaining.length,
            remaining_text: remaining.map((i) => i.text),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      "add_grocery_item",
      {
        title: "Add grocery item",
        description: "Add something to the current shopping list that isn't tied to a recipe (milk, paper towels...).",
        inputSchema: z.object({
          name: z.string(),
          quantity: z.number().nonnegative().optional(),
          unit: z.string().optional(),
          category: z.enum(ingredientCategories).optional(),
        }),
      },
      async ({ name, quantity, unit, category }) => {
        try {
          const list = await addManualItem({ name, quantity, unit, category });
          return text({ ok: true, item_count: list.items.length });
        } catch (err) {
          return errorResult(err);
        }
      },
    );
  },
  {
    serverInfo: { name: "family-meals", version: "0.1.0" },
    instructions:
      "Tools for a family's recipe book and weekly supper plan. Dates are YYYY-MM-DD in the household's local timezone; 'tonight' means today's supper. When suggesting what to cook, favor recipes with short total time, low complexity and a high family rating.",
  },
);

/**
 * Bearer-token auth. Set MCP_API_KEY in the environment and give that value
 * to each assistant as its bearer token. If it isn't set the endpoint is open,
 * which is only acceptable on localhost.
 */
const authed = withMcpAuth(
  handler,
  (_req, token) => {
    const expected = process.env.MCP_API_KEY;
    if (!expected) return { token: "anonymous", clientId: "local", scopes: ["household"] };
    if (!token || !constantTimeEqual(token, expected)) return undefined;
    return { token, clientId: "household", scopes: ["household"] };
  },
  { required: Boolean(process.env.MCP_API_KEY) },
);

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export { authed as GET, authed as POST, authed as DELETE };
