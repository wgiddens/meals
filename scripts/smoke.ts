/**
 * End-to-end check of the data layer against a throwaway embedded database:
 * create recipes, plan a week, mark a supper cooked, rate and patch a recipe,
 * build a grocery list, add a manual item, check off and remove items by name,
 * rebuild and make sure checked state survives. Also the sign-in gate's pure
 * decisions (gateMode, devOwnerAllowed, safeReturnPath) and the dev owner.
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

  // The sign-in return path must never point off-site, or back to sign-in.
  const { safeReturnPath, gateMode, devOwnerAllowed } = await import("@/lib/gate");
  for (const bad of [
    "//evil.example",
    "/\\evil.example",
    "/%5Cevil.example",
    "https://evil.example",
    "/plan\u0000",
    "/sign-in?next=%2Fplan",
    "/sign-in/",
    "",
    undefined,
  ]) {
    assert(safeReturnPath(bad) === "/", `return path ${JSON.stringify(bad)} falls back to /`);
  }
  assert(safeReturnPath("/plan?x=1") === "/plan?x=1", "return path /plan?x=1 is allowed");
  assert(safeReturnPath("/recipes/abc") === "/recipes/abc", "return path /recipes/abc is allowed");

  // Who is let in, decided from the environment alone. Production is checked
  // first: no sign-in configuration can make it reach the dev owner.
  const google = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };
  const gateCases: [Record<string, string | undefined>, string][] = [
    [{ NODE_ENV: "development" }, "dev-owner"],
    [{}, "dev-owner"],
    [{ NODE_ENV: "test", GOOGLE_CLIENT_ID: "id" }, "dev-owner"],
    [{ NODE_ENV: "development", GOOGLE_CLIENT_ID: " ", GOOGLE_CLIENT_SECRET: "secret" }, "dev-owner"],
    [{ NODE_ENV: "development", ...google }, "sign-in"],
    [{ NODE_ENV: "production" }, "closed"],
    [{ NODE_ENV: "production", BETTER_AUTH_SECRET: "s" }, "closed"],
    [{ NODE_ENV: "production", ...google }, "closed"],
    [{ NODE_ENV: "production", ...google, BETTER_AUTH_SECRET: " " }, "closed"],
    [{ NODE_ENV: "production", ...google, BETTER_AUTH_SECRET: "s" }, "sign-in"],
  ];
  for (const [env, expected] of gateCases) {
    assert(gateMode(env) === expected, `gateMode(${JSON.stringify(env)}) is ${expected}`);
    assert(
      devOwnerAllowed(env) === (expected === "dev-owner"),
      `devOwnerAllowed(${JSON.stringify(env)}) is ${expected === "dev-owner"}`,
    );
  }

  // /api/mcp's bearer check. Production with no key refuses every request,
  // with or without a token; development with no key is open.
  const { verifyMcpToken } = await import("@/lib/mcp-auth");
  for (const token of [undefined, "", "anything"]) {
    assert(
      verifyMcpToken(token, { NODE_ENV: "production" }) === undefined,
      `MCP: production with no key refuses token ${JSON.stringify(token)}`,
    );
  }
  assert(verifyMcpToken(undefined, { NODE_ENV: "development" })?.clientId === "local", "MCP: development with no key is open");
  const keyed = { NODE_ENV: "production", MCP_API_KEY: "k-123" };
  assert(verifyMcpToken("k-123", keyed)?.token === "k-123", "MCP: the right key is accepted");
  for (const token of [undefined, "k-12", "k-1234", "K-123"]) {
    assert(verifyMcpToken(token, keyed) === undefined, `MCP: token ${JSON.stringify(token)} is refused when a key is set`);
  }

  // Every exported Server Action starts with requireMember() (or
  // requireOwner()), in every "use server" file under src. Read from source
  // because calling them needs a Next.js request. The scan fails closed: an
  // export it cannot check, or a "use server" anywhere but the top of a file,
  // is a problem rather than something to skip.
  const USE_SERVER = /["']use server["']/g;
  /** Problems with a file's Server Actions; empty when every one is guarded. */
  const scanServerActions = (source: string): { problems: string[]; actions: number } => {
    // The directive must come first, after any comments and blank lines.
    const body = source.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, "");
    const topLevel = /^["']use server["']\s*;?/.test(body);
    const directives = source.match(USE_SERVER)?.length ?? 0;
    const problems: string[] = [];
    if (directives > (topLevel ? 1 : 0)) {
      problems.push('"use server" appears other than as the first statement of the file');
    }
    if (!topLevel) return { problems, actions: 0 };
    let actions = 0;
    for (const match of source.matchAll(/\bexport\s+([^\n]*)/g)) {
      const rest = match[1];
      if (/^(type|interface)\s/.test(rest)) continue;
      const fn = /^async\s+function\s+(\w+)\s*\(/.exec(rest);
      if (!fn) {
        problems.push(`export the scan cannot check: "export ${rest.trim().slice(0, 40)}"`);
        continue;
      }
      const guarded = new RegExp(
        `^async\\s+function\\s+${fn[1]}\\s*\\([^)]*\\)[^{]*\\{\\s*(const\\s+\\w+\\s*=\\s*)?await\\s+require(Member|Owner)\\(\\);`,
      );
      if (!guarded.test(source.slice(match.index + "export ".length).replace(/^\s+/, ""))) {
        problems.push(`Server Action ${fn[1]} does not start with requireMember() or requireOwner()`);
      }
      actions++;
    }
    return { problems, actions };
  };

  // Each way round the scan that review found must now be a problem.
  const guardedAction = 'export async function ok(formData: FormData) {\n  await requireMember();\n}\n';
  const bypasses: [string, string][] = [
    ["an exported arrow function", `"use server";\n${guardedAction}export const x = async () => {};\n`],
    ["a comment before the directive", `// actions\n/* more */\n"use server";\nexport async function bad() {\n  return 1;\n}\n`],
    ["export default", `"use server";\n${guardedAction}export default async function () {}\n`],
    ["export { ... }", `"use server";\n${guardedAction}async function y() {}\nexport { y };\n`],
    ["an inline directive in a page", `export default function Page() {\n  async function act() {\n    "use server";\n  }\n  return null;\n}\n`],
    ["an unguarded action", `"use server";\nexport async function bad(formData: FormData) {\n  console.log(formData);\n  await requireMember();\n}\n`],
  ];
  for (const [label, fixture] of bypasses) {
    assert(scanServerActions(fixture).problems.length > 0, `the action scan catches ${label}`);
  }
  const fine = scanServerActions(`/** Actions. */\n"use server";\nexport type T = 1;\n${guardedAction}`);
  assert(fine.problems.length === 0 && fine.actions === 1, "the action scan accepts a guarded action after a comment");

  const sourceFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx|js|jsx|mjs)$/.test(e.name) ? [full] : [];
    });
  let actionCount = 0;
  const actionProblems: string[] = [];
  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    const { problems, actions } = scanServerActions(fs.readFileSync(file, "utf8"));
    const rel = path.relative(process.cwd(), file);
    actionProblems.push(...problems.map((p) => `${rel}: ${p}`));
    actionCount += actions;
  }
  assert(
    actionProblems.length === 0,
    `every Server Action under src starts with requireMember() or requireOwner()${
      actionProblems.length ? `:\n  ${actionProblems.join("\n  ")}` : ""
    }`,
  );
  assert(actionCount >= 9, `found the Server Actions to check (${actionCount})`);

  // The dev owner is created on first use, with the family row, and reused.
  const { ensureDevOwner, DEV_OWNER } = await import("@/lib/member");
  const { listFamily } = await import("@/lib/family");
  const devOwner = await ensureDevOwner();
  assert(
    devOwner.id === DEV_OWNER.id && devOwner.role === "owner" && devOwner.email === DEV_OWNER.email,
    "the dev owner is created on first use with role owner",
  );
  const familyAfterDevOwner = await listFamily();
  assert(
    familyAfterDevOwner.members.length === 1 && familyAfterDevOwner.members[0].id === DEV_OWNER.id,
    "the dev owner is the family's only member",
  );
  const [againA, againB] = await Promise.all([ensureDevOwner(), ensureDevOwner()]);
  assert(
    againA.id === DEV_OWNER.id && againB.id === DEV_OWNER.id && (await listFamily()).members.length === 1,
    "later calls, even at once, reuse the same dev owner",
  );
  // An owner who signed in for real (while Google was configured) is used as is.
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const smokeDb = await getDb();
  await smokeDb.delete(schema.user).where(eq(schema.user.id, DEV_OWNER.id));
  await smokeDb
    .insert(schema.user)
    .values({ id: "real-owner", name: "Real", email: "real@example.com", emailVerified: true, role: "owner" });
  const reused = await ensureDevOwner();
  assert(
    reused.id === "real-owner" && (await listFamily()).members.length === 1,
    "with an owner already present, the dev shortcut uses that owner and creates no other",
  );

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
