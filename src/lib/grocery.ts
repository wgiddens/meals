import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  groceryItems,
  groceryLists,
  ingredientCategories,
  type GroceryItem,
  type GroceryList,
  type IngredientCategory,
} from "@/db/schema";
import { addDays, todayIso, weekStart } from "./dates";
import { formatQuantity, normalizeName, normalizeUnit } from "./format";
import { getPlan } from "./plan";

export type GroceryListWithItems = GroceryList & { items: GroceryItem[] };

type Aggregated = {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: IngredientCategory;
  forRecipes: string[];
};

const CATEGORY_ORDER: IngredientCategory[] = [...ingredientCategories];

/**
 * Combine the ingredient lines of every planned recipe in a date range into
 * one shopping list. Lines with the same (normalized name, unit) are summed;
 * lines with different units for the same thing are kept separate rather than
 * guessed at.
 */
export async function aggregatePlanIngredients(
  start: string,
  end: string,
): Promise<Aggregated[]> {
  const dayCount =
    Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  const days = await getPlan(start, Math.max(1, dayCount));
  const buckets = new Map<string, Aggregated>();

  for (const day of days) {
    const recipe = day.meal?.recipe;
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const unit = normalizeUnit(ing.unit) || null;
      const key = `${normalizeName(ing.name)}|${unit ?? ""}`;
      const qty = ing.quantity == null ? null : Number(ing.quantity);
      const existing = buckets.get(key);
      if (existing) {
        if (existing.quantity != null && qty != null) existing.quantity += qty;
        else if (qty != null && existing.quantity == null) existing.quantity = qty;
        if (!existing.forRecipes.includes(recipe.title)) {
          existing.forRecipes.push(recipe.title);
        }
      } else {
        buckets.set(key, {
          name: ing.name.trim(),
          quantity: qty,
          unit,
          category: ing.category,
          forRecipes: [recipe.title],
        });
      }
    }
  }

  return Array.from(buckets.values()).sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.name.localeCompare(b.name),
  );
}

export async function getCurrentList(): Promise<GroceryListWithItems | null> {
  const db = await getDb();
  const row = await db.query.groceryLists.findFirst({
    orderBy: [desc(groceryLists.createdAt)],
    with: { items: { orderBy: [asc(groceryItems.position), asc(groceryItems.name)] } },
  });
  return row ?? null;
}

/**
 * (Re)build the shopping list for a plan window. Plan-derived items are
 * regenerated; manually added items and the "checked" state of anything that
 * is still on the list survive the rebuild.
 */
export async function buildListFromPlan(
  start: string = weekStart(todayIso()),
  end: string = addDays(start, 6),
): Promise<GroceryListWithItems> {
  const db = await getDb();
  const aggregated = await aggregatePlanIngredients(start, end);
  const previous = await getCurrentList();
  const sameWindow =
    previous && previous.startDate === start && previous.endDate === end;

  const checkedBefore = new Map<string, boolean>();
  const manualItems: GroceryItem[] = [];
  if (previous) {
    for (const item of previous.items) {
      checkedBefore.set(`${normalizeName(item.name)}|${normalizeUnit(item.unit)}`, item.checked);
      if (item.source === "manual" && sameWindow) manualItems.push(item);
    }
  }

  const list = await db.transaction(async (tx) => {
    let listId: string;
    if (sameWindow && previous) {
      listId = previous.id;
      await tx.delete(groceryItems).where(eq(groceryItems.listId, listId));
      await tx
        .update(groceryLists)
        .set({ updatedAt: new Date() })
        .where(eq(groceryLists.id, listId));
    } else {
      const [created] = await tx
        .insert(groceryLists)
        .values({ startDate: start, endDate: end })
        .returning();
      listId = created.id;
    }

    const rows = [
      ...aggregated.map((a, i) => ({
        listId,
        name: a.name,
        quantity: a.quantity == null ? null : String(a.quantity),
        unit: a.unit,
        category: a.category,
        source: "plan",
        forRecipes: a.forRecipes,
        checked: checkedBefore.get(`${normalizeName(a.name)}|${normalizeUnit(a.unit)}`) ?? false,
        position: i,
      })),
      ...manualItems.map((m, i) => ({
        listId,
        name: m.name,
        quantity: m.quantity,
        unit: m.unit,
        category: m.category,
        source: "manual",
        forRecipes: [] as string[],
        checked: m.checked,
        position: aggregated.length + i,
      })),
    ];
    if (rows.length) await tx.insert(groceryItems).values(rows);
    return listId;
  });

  const db2 = await getDb();
  const full = await db2.query.groceryLists.findFirst({
    where: eq(groceryLists.id, list),
    with: { items: { orderBy: [asc(groceryItems.position), asc(groceryItems.name)] } },
  });
  return full!;
}

export async function addManualItem(input: {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  category?: IngredientCategory;
}): Promise<GroceryListWithItems> {
  const db = await getDb();
  let list = await getCurrentList();
  if (!list) list = await buildListFromPlan();
  await db.insert(groceryItems).values({
    listId: list.id,
    name: input.name.trim(),
    quantity: input.quantity == null ? null : String(input.quantity),
    unit: input.unit?.trim() || null,
    category: input.category ?? "other",
    source: "manual",
    position: list.items.length,
  });
  return (await getCurrentList())!;
}

export async function setItemChecked(itemId: string, checked: boolean): Promise<GroceryItem | null> {
  const db = await getDb();
  const [row] = await db
    .update(groceryItems)
    .set({ checked })
    .where(eq(groceryItems.id, itemId))
    .returning();
  return row ?? null;
}

export async function removeItem(itemId: string): Promise<GroceryItem | null> {
  const db = await getDb();
  const [row] = await db.delete(groceryItems).where(eq(groceryItems.id, itemId)).returning();
  return row ?? null;
}

/**
 * Items on a list whose name matches what someone said ("milk", "the
 * tomatoes"). An exact match on the normalized name wins outright; otherwise
 * every item whose normalized name contains the words is returned, so the
 * caller can ask which one was meant.
 */
export function findItemsByName(items: GroceryItem[], name: string): GroceryItem[] {
  const needle = normalizeName(name);
  if (!needle) return [];
  const exact = items.filter((i) => normalizeName(i.name) === needle);
  if (exact.length) return exact;
  return items.filter((i) => normalizeName(i.name).includes(needle));
}

export function uncheckedCount(items: GroceryItem[]): number {
  return items.filter((i) => !i.checked).length;
}

export function groupByCategory(items: GroceryItem[]) {
  const groups = new Map<IngredientCategory, GroceryItem[]>();
  for (const item of items) {
    const arr = groups.get(item.category) ?? [];
    arr.push(item);
    groups.set(item.category, arr);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({
    category: c,
    items: groups.get(c)!,
  }));
}

export function formatItem(item: Pick<GroceryItem, "name" | "quantity" | "unit">) {
  return [formatQuantity(item.quantity), item.unit, item.name]
    .filter((p) => p && String(p).trim())
    .join(" ");
}

export function listToJson(list: GroceryListWithItems | null) {
  if (!list) return null;
  return {
    id: list.id,
    start_date: list.startDate,
    end_date: list.endDate,
    items: list.items.map((i) => ({
      id: i.id,
      text: formatItem(i),
      name: i.name,
      quantity: i.quantity == null ? null : Number(i.quantity),
      unit: i.unit,
      category: i.category,
      checked: i.checked,
      for_recipes: i.forRecipes,
      source: i.source,
    })),
  };
}
