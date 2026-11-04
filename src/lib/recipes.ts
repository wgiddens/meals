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

/**
 * A partial edit: only the fields present are changed. `ingredients`, when
 * given, replaces the whole ingredient list (there is no per-line merge).
 */
export const recipePatchSchema = z.object({
  title: z.string().trim().min(1, "Title is required").optional(),
  description: z.string().trim().nullable().optional(),
  sourceUrl: z.string().trim().url().nullable().optional().or(z.literal("")),
  servings: z.number().int().positive().nullable().optional(),
  prepMinutes: z.number().int().nonnegative().nullable().optional(),
  cookMinutes: z.number().int().nonnegative().nullable().optional(),
  complexity: z.enum(complexities).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  instructions: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  ingredients: z.array(ingredientInputSchema).optional(),
});

export type RecipePatch = z.input<typeof recipePatchSchema>;

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

/**
 * Every recipe whose title matches, for callers that need to detect
 * ambiguity (the assistant tools). A case-insensitive exact title match wins
 * outright; otherwise all substring matches are returned, best-rated first.
 */
export async function findRecipesByTitle(
  title: string,
  limit = 10,
): Promise<RecipeWithIngredients[]> {
  const needle = title.trim();
  if (!needle) return [];
  const db = await getDb();
  const exact = await db.query.recipes.findMany({
    where: ilike(recipes.title, needle),
    limit,
    with: { ingredients: { orderBy: [asc(recipeIngredients.position)] } },
  });
  if (exact.length) return exact;
  return db.query.recipes.findMany({
    where: ilike(recipes.title, `%${needle}%`),
    orderBy: [desc(recipes.rating), asc(recipes.title)],
    limit,
    with: { ingredients: { orderBy: [asc(recipeIngredients.position)] } },
  });
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

/**
 * Change only the given fields of a recipe. Unlike updateRecipe this leaves
 * the ingredient list alone unless `ingredients` is supplied, in which case
 * the whole list is replaced.
 */
export async function patchRecipe(
  id: string,
  raw: RecipePatch,
): Promise<RecipeWithIngredients> {
  const patch = recipePatchSchema.parse(raw);
  const db = await getDb();
  const set: Partial<typeof recipes.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description || null;
  if (patch.sourceUrl !== undefined) set.sourceUrl = patch.sourceUrl || null;
  if (patch.servings !== undefined) set.servings = patch.servings;
  if (patch.prepMinutes !== undefined) set.prepMinutes = patch.prepMinutes;
  if (patch.cookMinutes !== undefined) set.cookMinutes = patch.cookMinutes;
  if (patch.complexity !== undefined) set.complexity = patch.complexity;
  if (patch.rating !== undefined) set.rating = patch.rating;
  if (patch.tags !== undefined) set.tags = cleanTags(patch.tags);
  if (patch.instructions !== undefined) set.instructions = patch.instructions || null;
  if (patch.notes !== undefined) set.notes = patch.notes || null;

  const [row] = await db.update(recipes).set(set).where(eq(recipes.id, id)).returning();
  if (!row) throw new Error("Recipe not found");
  if (patch.ingredients !== undefined) {
    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    if (patch.ingredients.length) {
      await db
        .insert(recipeIngredients)
        .values(toIngredientRows(id, patch.ingredients));
    }
  }
  return (await getRecipe(id))!;
}

/**
 * Record how the family liked a recipe (1-5). An optional note is appended
 * to the recipe's notes as its own paragraph, so "we had it, it was a 4,
 * needs more salt" lands in one call without losing the existing notes.
 */
export async function rateRecipe(
  id: string,
  rating: number,
  note?: string | null,
): Promise<RecipeWithIngredients> {
  const parsedRating = z.number().int().min(1).max(5).parse(rating);
  const trimmed = note?.trim();
  if (!trimmed) return patchRecipe(id, { rating: parsedRating });
  const existing = await getRecipe(id);
  if (!existing) throw new Error("Recipe not found");
  const notes = existing.notes ? `${existing.notes}\n\n${trimmed}` : trimmed;
  return patchRecipe(id, { rating: parsedRating, notes });
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
