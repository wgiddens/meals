import { and, asc, between, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { plannedMeals, type PlannedMeal } from "@/db/schema";
import { addDays, relativeLabel, todayIso, weekDates, weekStart } from "./dates";
import { type RecipeWithIngredients } from "./recipes";
import { formatMinutes, totalMinutes } from "./format";

export const SUPPER = "supper";

export type PlannedMealWithRecipe = PlannedMeal & {
  recipe: RecipeWithIngredients | null;
};

export type PlanDay = {
  date: string;
  meal: PlannedMealWithRecipe | null;
};

async function mealsBetween(
  start: string,
  end: string,
  meal = SUPPER,
): Promise<PlannedMealWithRecipe[]> {
  const db = await getDb();
  return db.query.plannedMeals.findMany({
    where: and(between(plannedMeals.date, start, end), eq(plannedMeals.meal, meal)),
    orderBy: [asc(plannedMeals.date)],
    with: { recipe: { with: { ingredients: true } } },
  });
}

/** Every day in [start, start + days), with whatever is planned for supper. */
export async function getPlan(start: string, days = 7): Promise<PlanDay[]> {
  const dates = weekDates(start, days);
  const rows = await mealsBetween(dates[0], dates[dates.length - 1]);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return dates.map((date) => ({ date, meal: byDate.get(date) ?? null }));
}

export async function getWeekPlan(anyDateInWeek = todayIso()): Promise<PlanDay[]> {
  return getPlan(weekStart(anyDateInWeek), 7);
}

export async function getSupper(date = todayIso()): Promise<PlannedMealWithRecipe | null> {
  const [row] = await mealsBetween(date, date);
  return row ?? null;
}

export type SetMealInput = {
  date: string;
  meal?: string;
  recipeId?: string | null;
  note?: string | null;
};

/** Upsert the meal for a date. Pass neither recipeId nor note to clear it. */
export async function setMeal(input: SetMealInput): Promise<PlannedMealWithRecipe | null> {
  const db = await getDb();
  const meal = input.meal ?? SUPPER;
  const recipeId = input.recipeId || null;
  const note = input.note?.trim() || null;

  if (!recipeId && !note) {
    await db
      .delete(plannedMeals)
      .where(and(eq(plannedMeals.date, input.date), eq(plannedMeals.meal, meal)));
    return null;
  }

  await db
    .insert(plannedMeals)
    .values({ date: input.date, meal, recipeId, note })
    .onConflictDoUpdate({
      target: [plannedMeals.date, plannedMeals.meal],
      set: { recipeId, note, cooked: false },
    });
  return getSupper(input.date);
}

export async function markCooked(date: string, cooked = true, meal = SUPPER) {
  const db = await getDb();
  await db
    .update(plannedMeals)
    .set({ cooked })
    .where(and(eq(plannedMeals.date, date), eq(plannedMeals.meal, meal)));
}

/** Plain-English description of a planned meal, for the assistant tools. */
export function describeMeal(day: PlanDay, today = todayIso()): string {
  const when = relativeLabel(day.date, today);
  if (!day.meal) return `Nothing is planned for ${when} yet.`;
  const { recipe, note } = day.meal;
  if (recipe) {
    const mins = totalMinutes(recipe);
    const bits = [
      mins != null ? `about ${formatMinutes(mins)}` : null,
      recipe.complexity === "easy"
        ? "easy"
        : recipe.complexity === "hard"
          ? "an involved one"
          : null,
      recipe.rating ? `family rating ${recipe.rating}/5` : null,
    ].filter(Boolean);
    const detail = bits.length ? ` (${bits.join(", ")})` : "";
    const extra = note ? ` Note: ${note}` : "";
    return `${capitalize(when)} is ${recipe.title}${detail}.${extra}`;
  }
  return `${capitalize(when)}: ${note}.`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function planToJson(days: PlanDay[]) {
  return days.map((d) => ({
    date: d.date,
    meal: d.meal
      ? {
          recipe_id: d.meal.recipeId,
          recipe_title: d.meal.recipe?.title ?? null,
          note: d.meal.note,
          cooked: d.meal.cooked,
          total_minutes: d.meal.recipe ? totalMinutes(d.meal.recipe) : null,
          complexity: d.meal.recipe?.complexity ?? null,
        }
      : null,
  }));
}

export { addDays, todayIso, weekStart };
