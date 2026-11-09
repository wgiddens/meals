/**
 * End-to-end check of the data layer against a throwaway embedded database:
 * create recipes, plan a week, mark a supper cooked, rate and patch a recipe,
 * build a grocery list, add a manual item, check off and remove items by name,
 * rebuild and make sure checked state survives.
 *   npm run smoke
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PGLITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meals-smoke-"));
delete process.env.DATABASE_URL;

async function main() {
  const {
    createRecipe,
    listRecipes,
    findRecipeByTitle,
    findRecipesByTitle,
    getRecipe,
    patchRecipe,
    rateRecipe,
    deleteRecipe,
  } = await import("@/lib/recipes");
  const { setMeal, getWeekPlan, getSupper, describeMeal, markCooked } = await import("@/lib/plan");
  const {
    buildListFromPlan,
    addManualItem,
    setItemChecked,
    getCurrentList,
    findItemsByName,
    removeItem,
    uncheckedCount,
  } = await import("@/lib/grocery");
  const { todayIso, weekStart, addDays } = await import("@/lib/dates");

  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
    console.log(`ok - ${msg}`);
  };

  // The /login return path must never point off-site.
  const { safeReturnPath } = await import("@/lib/household");
  for (const bad of [
    "//evil.example",
    "/\\evil.example",
    "/%5Cevil.example",
    "https://evil.example",
    "/plan\u0000",
    "/login?next=%2Fplan",
    "",
    undefined,
  ]) {
    assert(safeReturnPath(bad) === "/", `return path ${JSON.stringify(bad)} falls back to /`);
  }
  assert(safeReturnPath("/plan?x=1") === "/plan?x=1", "return path /plan?x=1 is allowed");
  assert(safeReturnPath("/recipes/abc") === "/recipes/abc", "return path /recipes/abc is allowed");

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
  assert((await findRecipesByTitle("smoke")).length === 2, "findRecipesByTitle returns every partial match");
  assert(
    (await findRecipesByTitle("SMOKE PASTA")).map((r) => r.id).join() === pasta.id,
    "findRecipesByTitle: an exact (case-insensitive) title wins over partial matches",
  );
  assert((await findRecipesByTitle("no such recipe")).length === 0, "findRecipesByTitle: no matches is empty");

  // Rating and partial edits (what the assistant does after supper).
  const rated = await rateRecipe(pasta.id, 4, "needs more salt");
  assert(rated.rating === 4 && rated.notes === "needs more salt", "rateRecipe sets rating and starts the notes");
  const rated2 = await rateRecipe(pasta.id, 3, "  kids liked it  ");
  assert(rated2.rating === 3 && rated2.notes === "needs more salt\n\nkids liked it", "rateRecipe appends a note as a new paragraph");
  const rated3 = await rateRecipe(pasta.id, 5);
  assert(rated3.rating === 5 && rated3.notes === rated2.notes, "rateRecipe without a note leaves notes alone");
  let threw = false;
  try {
    await rateRecipe(pasta.id, 7);
  } catch {
    threw = true;
  }
  assert(threw, "rateRecipe rejects a rating outside 1-5");
  const noted = await rateRecipe(pasta.id, undefined, "try penne next time");
  assert(
    noted.rating === 5 && noted.notes === `${rated2.notes}\n\ntry penne next time`,
    "rateRecipe with only a note appends it and keeps the rating",
  );
  threw = false;
  try {
    await rateRecipe(pasta.id, undefined, "   ");
  } catch {
    threw = true;
  }
  assert(threw, "rateRecipe with neither a rating nor a note throws");
  assert((await findRecipesByTitle("smoke", 1)).length === 1, "findRecipesByTitle honours its limit");
  let zodName = "";
  try {
    await patchRecipe(pasta.id, { title: "  " });
  } catch (err) {
    zodName = err instanceof Error ? err.name : "";
  }
  assert(zodName === "ZodError", "patchRecipe rejects an empty title with a ZodError");
  assert((await getRecipe(pasta.id))!.title === "Smoke Pasta", "a rejected patch changes nothing");

  const patched = await patchRecipe(pasta.id, { cookMinutes: 20, tags: ["Italian", "italian", "Pasta"] });
  assert(patched.cookMinutes === 20 && patched.prepMinutes === 10, "patchRecipe changes only the given fields");
  assert(patched.tags.join() === "italian,pasta", "patchRecipe normalizes and de-duplicates tags");
  assert(patched.ingredients.length === 3 && patched.rating === 5, "patchRecipe without ingredients leaves them (and the rating) alone");
  const replaced = await patchRecipe(pasta.id, {
    ingredients: [
      { name: "ground beef", quantity: 1.5, unit: "lb", category: "meat" },
      { name: "tomato", quantity: 3, category: "produce" },
      { name: "spaghetti", quantity: 1, unit: "lb", category: "pantry" },
      { name: "parmesan", quantity: 0.5, unit: "cup", category: "dairy" },
    ],
  });
  assert(replaced.ingredients.length === 4 && replaced.ingredients[3].name === "parmesan", "patchRecipe replaces the ingredient list when given");
  assert((await getRecipe(pasta.id))!.updatedAt > pasta.updatedAt, "patchRecipe bumps updatedAt");
  threw = false;
  try {
    await patchRecipe("00000000-0000-0000-0000-000000000000", { title: "ghost" });
  } catch {
    threw = true;
  }
  assert(threw, "patchRecipe on an unknown id throws");

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

  const cooked = await markCooked(today);
  assert(cooked?.cooked === true && cooked.recipe?.id === tacos.id, "markCooked flags tonight and returns the meal");
  assert((await getSupper(today))?.cooked === true, "cooked flag persists");
  const uncooked = await markCooked(today, false);
  assert(uncooked?.cooked === false, "markCooked(false) clears the flag");
  assert((await markCooked(addDays(today, 5))) === null, "markCooked on an unplanned day returns null");
  await markCooked(today);

  const list = await buildListFromPlan(start, addDays(start, 6));
  const beef = list.items.find((i) => i.name.toLowerCase().includes("beef"));
  assert(beef && Number(beef.quantity) === 2.5 && beef.unit === "lb", "ground beef aggregated to 2.5 lb");
  const tomato = list.items.filter((i) => i.name.toLowerCase().startsWith("tomato"));
  assert(tomato.length === 1 && Number(tomato[0].quantity) === 5, "tomatoes/tomato merged into one line of 5");
  assert(beef!.forRecipes.length === 2, "item lists both recipes that need it");

  const checkedBeef = await setItemChecked(beef!.id, true);
  assert(checkedBeef?.checked === true, "setItemChecked returns the updated item");
  assert((await setItemChecked("00000000-0000-0000-0000-000000000000", true)) === null, "setItemChecked on an unknown id returns null");
  await addManualItem({ name: "paper towels", category: "other" });
  await addManualItem({ name: "Milk", quantity: 1, unit: "gal", category: "dairy" });
  await addManualItem({ name: "almond milk", category: "dairy" });

  // Name lookup the way an assistant would use it.
  const current = (await getCurrentList())!;
  assert(findItemsByName(current.items, "milk").map((i) => i.name).join() === "Milk", "exact name match wins over partial matches");
  assert(findItemsByName(current.items, "MILK ").length === 1, "name match is case- and whitespace-insensitive");
  assert(findItemsByName(current.items, "tomatoes").length === 1, "name match tolerates plurals");
  assert(findItemsByName(current.items, "paper").length === 1, "partial name matches when unique");
  assert(findItemsByName(current.items, "e").length > 1, "ambiguous partial names return every candidate");
  assert(findItemsByName(current.items, "caviar").length === 0, "unknown names return nothing");
  const before = uncheckedCount(current.items);
  const almond = findItemsByName(current.items, "almond")[0];
  const removed = await removeItem(almond.id);
  assert(removed?.id === almond.id, "removeItem returns the removed row");
  assert((await removeItem(almond.id)) === null, "removing it again returns null");
  assert(uncheckedCount((await getCurrentList())!.items) === before - 1, "unchecked count drops after a removal");

  const rebuilt = await buildListFromPlan(start, addDays(start, 6));
  const beef2 = rebuilt.items.find((i) => i.name.toLowerCase().includes("beef"));
  assert(beef2?.checked === true, "checked state survives a rebuild");
  assert(rebuilt.items.some((i) => i.name === "paper towels" && i.source === "manual"), "manual items survive a rebuild");
  assert(rebuilt.items.some((i) => i.name === "parmesan"), "rebuilt list picks up the patched ingredient list");
  assert(!rebuilt.items.some((i) => i.name === "almond milk"), "removed manual items stay removed");

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
