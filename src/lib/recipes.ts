import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  complexities,
  ingredientCategories,
  recipeIngredients,
  recipes,
  type Recipe,
  type RecipeIngredient,
} from "@/db/schema";
import { totalMinutes } from "./format";

export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1, "Ingredient needs a name"),
  quantity: z.number().nonnegative().nullable().optional(),
  unit: z.string().trim().nullable().optional(),
  note: z.string().trim().nullable().optional(),
  category: z.enum(ingredientCategories).optional(),
});

export const recipeInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().nullable().optional(),
  sourceUrl: z.string().trim().url().nullable().optional().or(z.literal("")),
  source: z.string().trim().nullable().optional(),
  servings: z.number().int().positive().nullable().optional(),
  prepMinutes: z.number().int().nonnegative().nullable().optional(),
  cookMinutes: z.number().int().nonnegative().nullable().optional(),
  complexity: z.enum(complexities).default("medium"),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  instructions: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  ingredients: z.array(ingredientInputSchema).default([]),
});

export type RecipeInput = z.input<typeof recipeInputSchema>;
export type RecipeWithIngredients = Recipe & { ingredients: RecipeIngredient[] };

export type RecipeFilter = {
  query?: string;
  maxMinutes?: number;
  complexity?: (typeof complexities)[number];
  tag?: string;
  minRating?: number;
  limit?: number;
};

export async function listRecipes(
  filter: RecipeFilter = {},
): Promise<RecipeWithIngredients[]> {
  const db = await getDb();
  const conditions = [];
  if (filter.query) {
    const q = `%${filter.query.trim()}%`;
    conditions.push(
      or(
        ilike(recipes.title, q),
        ilike(recipes.description, q),
        sql`exists (select 1 from ${recipeIngredients} ri where ri.recipe_id = ${recipes.id} and ri.name ilike ${q})`,
        sql`exists (select 1 from unnest(${recipes.tags}) t where t ilike ${q})`,
      ),
    );
  }
  if (filter.complexity) conditions.push(eq(recipes.complexity, filter.complexity));
  if (filter.tag) {
    conditions.push(sql`${filter.tag.toLowerCase()} = any(${recipes.tags})`);
  }
  if (filter.minRating) {
    conditions.push(sql`${recipes.rating} >= ${filter.minRating}`);
  }
  if (filter.maxMinutes) {
    conditions.push(
      sql`coalesce(${recipes.prepMinutes}, 0) + coalesce(${recipes.cookMinutes}, 0) <= ${filter.maxMinutes}`,
    );
  }

  const rows = await db.query.recipes.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(recipes.title)],
    limit: filter.limit ?? 200,
    with: { ingredients: { orderBy: [asc(recipeIngredients.position)] } },
  });
  return rows;
}

export async function getRecipe(
  id: string,
): Promise<RecipeWithIngredients | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const db = await getDb();
  const row = await db.query.recipes.findFirst({
    where: eq(recipes.id, id),
    with: { ingredients: { orderBy: [asc(recipeIngredients.position)] } },
  });
  return row ?? null;
}

/** Fuzzy lookup by title, used by the assistant tools. */
export async function findRecipeByTitle(
  title: string,
): Promise<RecipeWithIngredients | null> {
  const db = await getDb();
  const exact = await db.query.recipes.findFirst({
    where: ilike(recipes.title, title.trim()),
    with: { ingredients: { orderBy: [asc(recipeIngredients.position)] } },
  });
  if (exact) return exact;
  const partial = await db.query.recipes.findFirst({
    where: ilike(recipes.title, `%${title.trim()}%`),
    orderBy: [desc(recipes.rating), asc(recipes.title)],
    with: { ingredients: { orderBy: [asc(recipeIngredients.position)] } },
  });
  return partial ?? null;
}

export async function getRecipesByIds(
  ids: string[],
): Promise<RecipeWithIngredients[]> {
  if (!ids.length) return [];
  const db = await getDb();
  return db.query.recipes.findMany({
    where: inArray(recipes.id, ids),
    with: { ingredients: { orderBy: [asc(recipeIngredients.position)] } },
  });
}

function cleanTags(tags: string[]): string[] {
  return Array.from(
    new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  );
}

function toRecipeRow(input: z.output<typeof recipeInputSchema>) {
  return {
    title: input.title,
    description: input.description || null,
    sourceUrl: input.sourceUrl || null,
    source: input.source || null,
    servings: input.servings ?? null,
    prepMinutes: input.prepMinutes ?? null,
    cookMinutes: input.cookMinutes ?? null,
    complexity: input.complexity,
    rating: input.rating ?? null,
    tags: cleanTags(input.tags),
    instructions: input.instructions || null,
    notes: input.notes || null,
  };
}

function toIngredientRows(
  recipeId: string,
  ingredients: z.output<typeof ingredientInputSchema>[],
) {
  return ingredients.map((ing, i) => ({
    recipeId,
    name: ing.name,
    quantity: ing.quantity == null ? null : String(ing.quantity),
    unit: ing.unit || null,
    note: ing.note || null,
    category: ing.category ?? "other",
    position: i,
  }));
}

export async function createRecipe(
  raw: RecipeInput,
): Promise<RecipeWithIngredients> {
  const input = recipeInputSchema.parse(raw);
  const db = await getDb();
  const [row] = await db.insert(recipes).values(toRecipeRow(input)).returning();
  if (input.ingredients.length) {
    await db
      .insert(recipeIngredients)
      .values(toIngredientRows(row.id, input.ingredients));
  }
  return (await getRecipe(row.id))!;
}

export async function updateRecipe(
  id: string,
  raw: RecipeInput,
): Promise<RecipeWithIngredients> {
  const input = recipeInputSchema.parse(raw);
  const db = await getDb();
  const [row] = await db
    .update(recipes)
    .set({ ...toRecipeRow(input), updatedAt: new Date() })
    .where(eq(recipes.id, id))
    .returning();
  if (!row) throw new Error("Recipe not found");
  await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
  if (input.ingredients.length) {
    await db
      .insert(recipeIngredients)
      .values(toIngredientRows(id, input.ingredients));
  }
  return (await getRecipe(id))!;
}

export async function deleteRecipe(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(recipes).where(eq(recipes.id, id));
}

export async function allTags(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.execute<{ tag: string }>(
    sql`select distinct unnest(tags) as tag from ${recipes} order by tag`,
  );
  const list = Array.isArray(rows) ? rows : (rows as { rows: { tag: string }[] }).rows;
  return list.map((r) => r.tag);
}

/** A compact, assistant-friendly summary of a recipe. */
export function summarizeRecipe(r: RecipeWithIngredients) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    total_minutes: totalMinutes(r),
    prep_minutes: r.prepMinutes,
    cook_minutes: r.cookMinutes,
    complexity: r.complexity,
    rating: r.rating,
    servings: r.servings,
    tags: r.tags,
    ingredient_count: r.ingredients.length,
  };
}
