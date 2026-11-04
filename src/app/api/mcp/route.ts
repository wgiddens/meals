import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { complexities, ingredientCategories } from "@/db/schema";
import { addDays, isIsoDate, todayIso, weekStart } from "@/lib/dates";
import {
  addManualItem,
  buildListFromPlan,
  findItemsByName,
  formatItem,
  getCurrentList,
  listToJson,
  removeItem,
  setItemChecked,
  uncheckedCount,
  type GroceryListWithItems,
} from "@/lib/grocery";
import {
  describeMeal,
  getPlan,
  getSupper,
  markCooked,
  planToJson,
  setMeal,
} from "@/lib/plan";
import {
  createRecipe,
  findRecipeByTitle,
  findRecipesByTitle,
  getRecipe,
  listRecipes,
  patchRecipe,
  rateRecipe,
  summarizeRecipe,
  type RecipeWithIngredients,
} from "@/lib/recipes";
import { formatIngredient } from "@/lib/format";
import type { GroceryItem } from "@/db/schema";

/**
 * The assistant-facing API. Claude, ChatGPT, Gemini and anything else that
 * speaks MCP (Model Context Protocol) connects here and can answer "what's
 * for supper tonight?", look up recipes, plan meals, mark them cooked, rate
 * and edit recipes, and read, check off and trim the grocery list.
 *
 * Mounted at /api/mcp (Streamable HTTP). See README for client setup.
 */

const dateArg = z
  .string()
  .optional()
  .describe(
    "Calendar date as YYYY-MM-DD in the household timezone, or 'today', 'tonight', 'tomorrow', 'yesterday'. Defaults to today.",
  );

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

/** The full recipe shape returned by get_recipe and update_recipe. */
function recipeToJson(recipe: RecipeWithIngredients) {
  return {
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
  };
}

/**
 * Find exactly one recipe from an id or a title. A title that matches several
 * recipes is an error that lists the candidates, so the assistant can ask
 * which one was meant instead of editing the wrong recipe.
 */
async function resolveRecipe(recipe_id?: string, recipe_title?: string) {
  if (recipe_id) {
    const r = await getRecipe(recipe_id);
    if (!r) throw new Error(`No recipe with id ${recipe_id}`);
    return r;
  }
  if (recipe_title) {
    const matches = await findRecipesByTitle(recipe_title);
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
      throw new Error(`No recipe matching "${recipe_title}". Use list_recipes to search.`);
    }
    const options = matches.map((m) => `"${m.title}" (recipe_id ${m.id})`).join(", ");
    throw new Error(
      `"${recipe_title}" matches ${matches.length} recipes: ${options}. Call again with recipe_id or a more specific recipe_title.`,
    );
  }
  throw new Error("Provide recipe_id or recipe_title.");
}

/**
 * Find exactly one item on the current grocery list from an id or a name.
 * Same ambiguity rule as resolveRecipe: several name matches is an error that
 * lists them.
 */
async function resolveGroceryItem(
  item_id?: string,
  name?: string,
): Promise<{ list: GroceryListWithItems; item: GroceryItem }> {
  const list = await getCurrentList();
  if (!list) throw new Error("There is no grocery list yet. Call get_grocery_list first.");
  if (item_id) {
    const item = list.items.find((i) => i.id === item_id);
    if (!item) throw new Error(`No item with id ${item_id} on the current grocery list.`);
    return { list, item };
  }
  if (name) {
    const matches = findItemsByName(list.items, name);
    if (matches.length === 1) return { list, item: matches[0] };
    if (matches.length === 0) {
      throw new Error(`Nothing on the grocery list matches "${name}". Use get_grocery_list to see it.`);
    }
    const options = matches.map((m) => `"${formatItem(m)}" (item_id ${m.id})`).join(", ");
    throw new Error(
      `"${name}" matches ${matches.length} items: ${options}. Call again with item_id or a more specific name.`,
    );
  }
  throw new Error("Provide item_id or name.");
}

function groceryItemToJson(item: GroceryItem) {
  return {
    id: item.id,
    text: formatItem(item),
    name: item.name,
    category: item.category,
    checked: item.checked,
    for_recipes: item.forRecipes,
  };
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
      "mark_cooked",
      {
        title: "Mark a meal cooked",
        description:
          "Record that the planned supper for a date was actually cooked ('we had it'). Use cooked=false to undo. Errors if nothing is planned for that date. To also rate the recipe, follow up with rate_recipe.",
        inputSchema: z.object({
          date: dateArg,
          cooked: z
            .boolean()
            .optional()
            .describe("true (default) marks it cooked; false clears the flag."),
        }),
      },
      async ({ date, cooked }) => {
        try {
          const iso = resolveDate(date);
          const flag = cooked ?? true;
          const meal = await markCooked(iso, flag);
          if (!meal) {
            throw new Error(
              `Nothing is planned for ${iso}, so there is nothing to mark cooked. Use plan_meal first.`,
            );
          }
          const what = meal.recipe?.title ?? meal.note ?? "the planned supper";
          return text({
            ok: true,
            date: iso,
            cooked: meal.cooked,
            recipe_id: meal.recipeId,
            recipe_title: meal.recipe?.title ?? null,
            note: meal.note,
            summary: flag
              ? `Marked ${what} on ${iso} as cooked.`
              : `Cleared the cooked flag for ${what} on ${iso}.`,
          });
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
          return text(recipeToJson(recipe));
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
      "rate_recipe",
      {
        title: "Rate a recipe",
        description:
          "Record the family's rating (1-5) for a recipe after eating it ('it was a 4'). Optionally append a note to the recipe's notes, e.g. 'kids wanted more cheese'. Replaces any previous rating.",
        inputSchema: z.object({
          recipe_id: z.string().optional().describe("Exact recipe id, if known."),
          recipe_title: z
            .string()
            .optional()
            .describe(
              "Recipe title to match instead of recipe_id. Case-insensitive; a partial title works if it matches only one recipe.",
            ),
          rating: z.number().int().min(1).max(5).describe("1 (nobody ate it) to 5 (everyone wants it again)."),
          note: z
            .string()
            .optional()
            .describe("Optional remark to append to the recipe's notes as a new paragraph."),
        }),
      },
      async ({ recipe_id, recipe_title, rating, note }) => {
        try {
          const found = await resolveRecipe(recipe_id, recipe_title);
          const recipe = await rateRecipe(found.id, rating, note);
          return text({
            ok: true,
            recipe: summarizeRecipe(recipe),
            notes: recipe.notes,
            summary: `Rated ${recipe.title} ${rating}/5${note ? " and added a note" : ""}.`,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      "update_recipe",
      {
        title: "Update recipe",
        description:
          "Edit an existing recipe. Only the fields you pass are changed; everything else is kept. Pass `ingredients` to replace the whole ingredient list (include every ingredient, not just the changed ones). Returns the full updated recipe. There is no delete; to remove a recipe use the website.",
        inputSchema: z.object({
          recipe_id: z.string().optional().describe("Exact recipe id, if known."),
          recipe_title: z
            .string()
            .optional()
            .describe(
              "Current title to match instead of recipe_id. Case-insensitive; a partial title works if it matches only one recipe.",
            ),
          title: z.string().optional().describe("New title."),
          description: z.string().nullable().optional().describe("One or two sentences. null clears it."),
          source_url: z.string().nullable().optional().describe("Where the recipe came from. null clears it."),
          servings: z.number().int().positive().nullable().optional(),
          prep_minutes: z.number().int().nonnegative().nullable().optional(),
          cook_minutes: z.number().int().nonnegative().nullable().optional(),
          complexity: z.enum(complexities).optional().describe("easy, medium or hard (involved)."),
          rating: z.number().int().min(1).max(5).nullable().optional().describe("Family rating 1-5. null clears it."),
          tags: z.array(z.string()).optional().describe("Replaces the tag list. Lowercased and de-duplicated."),
          instructions: z.string().nullable().optional().describe("Full replacement of the steps, one per line."),
          notes: z.string().nullable().optional().describe("Full replacement of the notes. To append a remark, use rate_recipe."),
          ingredients: z
            .array(
              z.object({
                name: z.string(),
                quantity: z.number().nonnegative().nullable().optional(),
                unit: z.string().nullable().optional(),
                note: z.string().nullable().optional().describe("e.g. 'diced', 'optional'"),
                category: z.enum(ingredientCategories).optional().describe("Store aisle. Default other."),
              }),
            )
            .optional()
            .describe("Complete replacement ingredient list, same shape as add_recipe. Omit to leave ingredients unchanged."),
        }),
      },
      async (args) => {
        try {
          const found = await resolveRecipe(args.recipe_id, args.recipe_title);
          const changed = Object.keys(args).filter(
            (k) => k !== "recipe_id" && k !== "recipe_title" && args[k as keyof typeof args] !== undefined,
          );
          if (!changed.length) throw new Error("Nothing to update: pass at least one field to change.");
          const recipe = await patchRecipe(found.id, {
            title: args.title,
            description: args.description,
            sourceUrl: args.source_url,
            servings: args.servings,
            prepMinutes: args.prep_minutes,
            cookMinutes: args.cook_minutes,
            complexity: args.complexity,
            rating: args.rating,
            tags: args.tags,
            instructions: args.instructions,
            notes: args.notes,
            ingredients: args.ingredients,
          });
          return text({
            ok: true,
            changed,
            summary: `Updated ${recipe.title}: ${changed.join(", ")}.`,
            recipe: recipeToJson(recipe),
          });
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

    server.registerTool(
      "check_grocery_item",
      {
        title: "Check off a grocery item",
        description:
          "Tick an item off the current shopping list ('got the milk'), or untick it with checked=false. Identify the item by item_id (from get_grocery_list) or by name. Returns how many items are still unchecked.",
        inputSchema: z.object({
          item_id: z.string().optional().describe("Exact item id from get_grocery_list, if known."),
          name: z
            .string()
            .optional()
            .describe("Item name to match instead of item_id, e.g. 'milk'. Must match exactly one item on the list."),
          checked: z.boolean().optional().describe("true (default) checks it off; false puts it back."),
        }),
      },
      async ({ item_id, name, checked }) => {
        try {
          const flag = checked ?? true;
          const { item } = await resolveGroceryItem(item_id, name);
          const updated = (await setItemChecked(item.id, flag)) ?? { ...item, checked: flag };
          const list = (await getCurrentList())!;
          const remaining = uncheckedCount(list.items);
          return text({
            ok: true,
            item: groceryItemToJson(updated),
            remaining_count: remaining,
            summary: `${flag ? "Checked off" : "Unchecked"} ${formatItem(updated)}. ${remaining} item${remaining === 1 ? "" : "s"} left.`,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    server.registerTool(
      "remove_grocery_item",
      {
        title: "Remove a grocery item",
        description:
          "Take an item off the current shopping list entirely ('we don't need eggs'). Identify it by item_id (from get_grocery_list) or by name. To mark something as bought instead, use check_grocery_item. Note that items that came from a planned recipe will reappear if the list is rebuilt from the plan.",
        inputSchema: z.object({
          item_id: z.string().optional().describe("Exact item id from get_grocery_list, if known."),
          name: z
            .string()
            .optional()
            .describe("Item name to match instead of item_id, e.g. 'eggs'. Must match exactly one item on the list."),
        }),
      },
      async ({ item_id, name }) => {
        try {
          const { item } = await resolveGroceryItem(item_id, name);
          const removed = (await removeItem(item.id)) ?? item;
          const list = (await getCurrentList())!;
          const remaining = uncheckedCount(list.items);
          return text({
            ok: true,
            removed: groceryItemToJson(removed),
            remaining_count: remaining,
            summary: `Removed ${formatItem(removed)} from the list. ${remaining} item${remaining === 1 ? "" : "s"} left.`,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );
  },
  {
    serverInfo: { name: "family-meals", version: "0.2.0" },
    instructions:
      "Tools for a family's recipe book, weekly supper plan and grocery list. Dates are YYYY-MM-DD in the household's local timezone; 'tonight' means today's supper. When suggesting what to cook, favor recipes with short total time, low complexity and a high family rating. After the family eats, mark_cooked records it and rate_recipe stores how it went. Grocery items can be checked off or removed by name.",
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
