/**
 * End-to-end check of the data layer against a throwaway embedded database:
 * create recipes, plan a week, build a grocery list, add a manual item,
 * rebuild and make sure checked state survives.
 *   npm run smoke
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PGLITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meals-smoke-"));
delete process.env.DATABASE_URL;

async function main() {
  const { createRecipe, listRecipes, findRecipeByTitle, deleteRecipe } = await import("@/lib/recipes");
  const { setMeal, getWeekPlan, getSupper, describeMeal } = await import("@/lib/plan");
  const { buildListFromPlan, addManualItem, setItemChecked, getCurrentList } = await import("@/lib/grocery");
  const { todayIso, weekStart, addDays } = await import("@/lib/dates");

  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
    console.log(`ok - ${msg}`);
  };

  const tacos = await createRecipe({
    title: "Smoke Tacos",
    prepMinutes: 10,
    cookMinutes: 15,
    complexity: "easy",
    rating: 5,
    tags: ["Mexican", "beef"],
    ingredients: [
      { name: "ground beef", quantity: 1, unit: "lb", category: "meat" },
      { name: "Tomatoes", quantity: 2, category: "produce" },
      { name: "shredded cheddar", quantity: 1, unit: "cup", category: "dairy" },
    ],
  });
  const pasta = await createRecipe({
    title: "Smoke Pasta",
    prepMinutes: 10,
    cookMinutes: 30,
    complexity: "medium",
    ingredients: [
      { name: "ground beef", quantity: 1.5, unit: "lb", category: "meat" },
      { name: "tomato", quantity: 3, category: "produce" },
      { name: "spaghetti", quantity: 1, unit: "lb", category: "pantry" },
    ],
  });
  assert(tacos.ingredients.length === 3, "recipe created with ingredients");
  assert(tacos.tags.includes("mexican"), "tags are normalized to lowercase");

  const quick = await listRecipes({ maxMinutes: 30 });
  assert(quick.some((r) => r.id === tacos.id) && !quick.some((r) => r.id === pasta.id), "maxMinutes filter works");
  const search = await listRecipes({ query: "spaghetti" });
  assert(search.length === 1 && search[0].id === pasta.id, "search matches ingredient names");
  assert((await findRecipeByTitle("smoke taco"))?.id === tacos.id, "fuzzy title lookup");

  const today = todayIso();
  const start = weekStart(today);
  await setMeal({ date: today, recipeId: tacos.id });
  await setMeal({ date: addDays(today, 1), recipeId: pasta.id, note: "double the sauce" });
  await setMeal({ date: addDays(today, 2), note: "leftovers" });
  const supper = await getSupper(today);
  assert(supper?.recipe?.title === "Smoke Tacos", "tonight's supper is set");
  console.log("   " + describeMeal({ date: today, meal: supper }));
  const week = await getWeekPlan(today);
  assert(week.length === 7 && week[0].date === start, "week plan covers 7 days from Sunday");
  assert(week.filter((d) => d.meal).length === 3, "three suppers planned");

  const list = await buildListFromPlan(start, addDays(start, 6));
  const beef = list.items.find((i) => i.name.toLowerCase().includes("beef"));
  assert(beef && Number(beef.quantity) === 2.5 && beef.unit === "lb", "ground beef aggregated to 2.5 lb");
  const tomato = list.items.filter((i) => i.name.toLowerCase().startsWith("tomato"));
  assert(tomato.length === 1 && Number(tomato[0].quantity) === 5, "tomatoes/tomato merged into one line of 5");
  assert(beef!.forRecipes.length === 2, "item lists both recipes that need it");

  await setItemChecked(beef!.id, true);
  await addManualItem({ name: "paper towels", category: "other" });
  const rebuilt = await buildListFromPlan(start, addDays(start, 6));
  const beef2 = rebuilt.items.find((i) => i.name.toLowerCase().includes("beef"));
  assert(beef2?.checked === true, "checked state survives a rebuild");
  assert(rebuilt.items.some((i) => i.name === "paper towels" && i.source === "manual"), "manual items survive a rebuild");

  await setMeal({ date: addDays(today, 2) });
  assert((await getWeekPlan(today)).filter((d) => d.meal).length === 2, "clearing a day works");

  await deleteRecipe(tacos.id);
  assert((await getSupper(today))?.recipeId === null, "deleting a recipe leaves the planned day (recipe set null)");
  assert((await getCurrentList())!.items.length === rebuilt.items.length, "list unaffected by recipe delete");

  console.log("\nAll smoke checks passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
