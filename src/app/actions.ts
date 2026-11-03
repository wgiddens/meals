"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ingredientCategories } from "@/db/schema";
import { isIsoDate } from "@/lib/dates";
import {
  addManualItem,
  buildListFromPlan,
  removeItem,
  setItemChecked,
} from "@/lib/grocery";
import { markCooked, setMeal } from "@/lib/plan";
import {
  createRecipe,
  deleteRecipe,
  recipeInputSchema,
  updateRecipe,
  type RecipeInput,
} from "@/lib/recipes";

/**
 * Server Actions. These are the only way the UI writes to the database.
 * There is no login yet (single household), so there is no auth check here;
 * see docs/ARCHITECTURE.md for where that lands on the roadmap.
 */

export type ActionState = { error?: string; fieldErrors?: Record<string, string> } | null;

function revalidateEverything() {
  revalidatePath("/", "layout");
}

export async function saveRecipeAction(
  recipeId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let input: RecipeInput;
  try {
    input = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { error: "Could not read the form" };
  }
  const parsed = recipeInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".") || "form"] = issue.message;
    }
    return { error: "Please fix the highlighted fields", fieldErrors };
  }

  const saved = recipeId
    ? await updateRecipe(recipeId, parsed.data)
    : await createRecipe(parsed.data);
  revalidateEverything();
  redirect(`/recipes/${saved.id}`);
}

export async function deleteRecipeAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return;
  await deleteRecipe(id);
  revalidateEverything();
  redirect("/recipes");
}

export async function setMealAction(formData: FormData) {
  const date = String(formData.get("date") ?? "");
  if (!isIsoDate(date)) return;
  const recipeId = String(formData.get("recipeId") ?? "");
  const note = String(formData.get("note") ?? "");
  await setMeal({
    date,
    recipeId: recipeId && recipeId !== "__none__" ? recipeId : null,
    note: note || null,
  });
  revalidateEverything();
}

export async function clearMealAction(formData: FormData) {
  const date = String(formData.get("date") ?? "");
  if (!isIsoDate(date)) return;
  await setMeal({ date, recipeId: null, note: null });
  revalidateEverything();
}

export async function toggleCookedAction(formData: FormData) {
  const date = String(formData.get("date") ?? "");
  if (!isIsoDate(date)) return;
  await markCooked(date, formData.get("cooked") === "true");
  revalidateEverything();
}

export async function buildGroceryListAction(formData: FormData) {
  const start = String(formData.get("start") ?? "");
  const end = String(formData.get("end") ?? "");
  await buildListFromPlan(
    isIsoDate(start) ? start : undefined,
    isIsoDate(end) ? end : undefined,
  );
  revalidatePath("/grocery");
}

export async function toggleGroceryItemAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return;
  await setItemChecked(id, formData.get("checked") === "true");
  revalidatePath("/grocery");
}

export async function removeGroceryItemAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return;
  await removeItem(id);
  revalidatePath("/grocery");
}

export async function addGroceryItemAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const qty = Number(formData.get("quantity"));
  const category = String(formData.get("category") ?? "other");
  await addManualItem({
    name,
    quantity: Number.isFinite(qty) && qty > 0 ? qty : null,
    unit: String(formData.get("unit") ?? "") || null,
    category: (ingredientCategories as readonly string[]).includes(category)
      ? (category as (typeof ingredientCategories)[number])
      : "other",
  });
  revalidatePath("/grocery");
}
