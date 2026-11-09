/**
 * Checks the URL-import extractor against fixture pages, with no network and
 * no API key: JSON-LD mapping (durations, servings, HowToSection steps,
 * @graph), the ingredient-line parser, the aisle guesser, the HTML-to-text
 * fallback input, and the URL guard.
 *   npm run check:import   (also runs as the first half of `npm run smoke`)
 */
import fs from "node:fs";
import path from "node:path";

const fixtures = path.join(__dirname, "fixtures", "import");
const read = (name: string) => fs.readFileSync(path.join(fixtures, name), "utf8");

let failures = 0;
const assert = (cond: unknown, msg: string) => {
  if (!cond) {
    failures++;
    console.error(`FAIL - ${msg}`);
  } else {
    console.log(`ok - ${msg}`);
  }
};
const eq = <T>(actual: T, expected: T, msg: string) =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  );

async function main() {
  const { extractRecipeFromJsonLd, isoDurationToMinutes, parseYield, instructionsToText } = await import(
    "@/lib/import/jsonld"
  );
  const { parseIngredientLine, guessCategory, toDraftIngredient } = await import("@/lib/import/ingredients");
  const { htmlToText, pageTitle, decodeEntities } = await import("@/lib/import/html");
  const { validateImportUrl, ImportUrlError, isPrivateAddress } = await import("@/lib/import/fetch");

  // --- durations, yields, steps ------------------------------------------------
  eq(isoDurationToMinutes("PT1H30M"), 90, "PT1H30M is 90 minutes");
  eq(isoDurationToMinutes("PT45M"), 45, "PT45M is 45 minutes");
  eq(isoDurationToMinutes("P0DT0H25M"), 25, "P0DT0H25M is 25 minutes");
  eq(isoDurationToMinutes("PT1.5H"), 90, "PT1.5H is 90 minutes");
  eq(isoDurationToMinutes("PT"), null, "empty duration is null");
  eq(isoDurationToMinutes("45 minutes"), null, "non-ISO duration is null");
  eq(parseYield(6), 6, "numeric yield");
  eq(parseYield("4 servings"), 4, "yield starting with a number");
  eq(parseYield(["Serves 6", "6"]), 6, "yield array / Serves N");
  eq(parseYield("a crowd"), null, "non-numeric yield is null");
  eq(instructionsToText("Mix.\nBake."), "1. Mix.\n2. Bake.", "newline-separated string steps");
  eq(
    instructionsToText("<ol><li>Mix.</li><li>Bake.</li></ol>"),
    "1. Mix.\n2. Bake.",
    "HTML list string steps",
  );

  // --- ingredient lines ----------------------------------------------------------
  eq(
    parseIngredientLine("1 ½ lbs boneless skinless chicken thighs, cut into strips"),
    { name: "boneless skinless chicken thighs", quantity: 1.5, unit: "lb", note: "cut into strips" },
    "mixed unicode fraction + lbs + comma note",
  );
  eq(
    parseIngredientLine("2 tablespoons olive oil"),
    { name: "olive oil", quantity: 2, unit: "tbsp", note: null },
    "tablespoons normalizes to tbsp",
  );
  eq(
    parseIngredientLine("1 (14 oz) can diced tomatoes"),
    { name: "diced tomatoes", quantity: 1, unit: "can", note: "14 oz" },
    "parenthetical size becomes the note",
  );
  eq(
    parseIngredientLine("1-2 jalapeños, seeded and minced"),
    { name: "jalapeños", quantity: 1, unit: null, note: "1–2; seeded and minced" },
    "range keeps the low number and records the range",
  );
  eq(
    parseIngredientLine("½ cup shredded cheddar cheese"),
    { name: "shredded cheddar cheese", quantity: 0.5, unit: "cup", note: null },
    "bare unicode fraction",
  );
  eq(parseIngredientLine("3/4 cup sugar"), { name: "sugar", quantity: 0.75, unit: "cup", note: null }, "ascii fraction");
  eq(
    parseIngredientLine("1 1/2 cups of flour, sifted"),
    { name: "flour", quantity: 1.5, unit: "cup", note: "sifted" },
    "mixed ascii fraction and 'of'",
  );
  eq(parseIngredientLine("8 corn tortillas"), { name: "corn tortillas", quantity: 8, unit: null, note: null }, "count, no unit");
  eq(parseIngredientLine("2 large eggs"), { name: "eggs", quantity: 2, unit: null, note: "large" }, "size word is a note");
  eq(
    parseIngredientLine("Salt and black pepper to taste"),
    { name: "Salt and black pepper", quantity: null, unit: null, note: "to taste" },
    "'to taste' without a comma",
  );
  eq(parseIngredientLine("Pinch of nutmeg"), { name: "nutmeg", quantity: null, unit: "pinch", note: null }, "pinch of");
  eq(parseIngredientLine("Cilantro"), { name: "Cilantro", quantity: null, unit: null, note: null }, "name only");
  eq(parseIngredientLine("1.5 kg potatoes"), { name: "potatoes", quantity: 1.5, unit: "kg", note: null }, "decimal + kg");
  eq(parseIngredientLine("4 cloves garlic, minced"), { name: "garlic", quantity: 4, unit: "clove", note: "minced" }, "cloves");
  eq(parseIngredientLine("2 to 3 cups water"), { name: "water", quantity: 2, unit: "cup", note: "2–3" }, "'to' range");
  eq(parseIngredientLine("3 Tbsp. soy sauce"), { name: "soy sauce", quantity: 3, unit: "tbsp", note: null }, "'Tbsp.' with a period");
  eq(parseIngredientLine("1 lb. chicken"), { name: "chicken", quantity: 1, unit: "lb", note: null }, "'lb.' with a period");
  eq(parseIngredientLine("2 c. flour"), { name: "flour", quantity: 2, unit: "cup", note: null }, "'c.' with a period");
  eq(parseIngredientLine(".5 tsp salt"), { name: "salt", quantity: 0.5, unit: "tsp", note: null }, "leading '.5'");
  eq(
    instructionsToText(["Mix.", "Stir.", "3. Bake.", "Cool."]),
    "1. Mix.\n2. Stir.\n3. Bake.\n4. Cool.",
    "pre-numbered step does not reset numbering",
  );
  eq(
    instructionsToText(["Mix.", "5. Bake.", "Cool."]),
    "1. Mix.\n5. Bake.\n6. Cool.",
    "numbering continues from a step's own number",
  );

  eq(guessCategory("boneless skinless chicken thighs"), "meat", "chicken is meat");
  eq(guessCategory("chicken broth"), "pantry", "chicken broth is pantry");
  eq(guessCategory("shredded cheddar cheese"), "dairy", "cheddar is dairy");
  eq(guessCategory("corn tortillas"), "bakery", "tortillas are bakery");
  eq(guessCategory("jalapeños"), "produce", "jalapeños are produce");
  eq(guessCategory("ground cumin"), "spices", "cumin is spices");
  eq(guessCategory("garlic powder"), "spices", "garlic powder is spices, not produce");
  eq(guessCategory("frozen peas"), "frozen", "frozen peas are frozen, not produce");
  eq(guessCategory("shrimp"), "seafood", "shrimp is seafood");
  eq(guessCategory("dry white wine"), "beverages", "wine is beverages");
  eq(guessCategory("olive oil"), "pantry", "oil is pantry");
  eq(guessCategory("coconut milk"), "pantry", "coconut milk is pantry, not dairy");
  eq(guessCategory("mystery ingredient"), "other", "unknown defaults to other");
  eq(toDraftIngredient("2 lb ground beef").category, "meat", "toDraftIngredient assigns a category");

  // --- fixture 1: plain JSON-LD ----------------------------------------------------
  const tacos = extractRecipeFromJsonLd(read("plain-jsonld.html"));
  assert(tacos, "plain fixture yields a draft");
  if (tacos) {
    eq(tacos.title, "Weeknight Chicken Tacos", "plain: title");
    assert(tacos.description.includes("half an hour & endlessly"), "plain: description entities decoded");
    eq(tacos.prep_minutes, 10, "plain: prep minutes");
    eq(tacos.cook_minutes, 20, "plain: cook minutes");
    eq(tacos.servings, 4, "plain: servings from '4 servings'");
    eq(tacos.tags, ["chicken", "tacos", "weeknight", "dinner", "mexican"], "plain: tags from keywords, category, cuisine");
    eq(tacos.complexity, "easy", "plain: 30 minutes and 4 steps is easy");
    eq(tacos.ingredients.length, 10, "plain: all ingredient lines kept");
    eq(
      tacos.ingredients[0],
      { name: "boneless skinless chicken thighs", quantity: 1.5, unit: "lb", note: "cut into strips", category: "meat" },
      "plain: first ingredient fully parsed",
    );
    eq(tacos.ingredients[4].category, "dairy", "plain: cheddar is dairy");
    eq(tacos.ingredients[9], { name: "Cilantro", quantity: null, unit: null, note: null, category: "produce" }, "plain: name-only line kept");
    assert(tacos.instructions.startsWith("1. Heat the oil"), "plain: steps numbered");
    assert(tacos.instructions.includes("jalapeños"), "plain: entities in steps decoded");
    eq(tacos.instructions.split("\n").length, 4, "plain: four steps");
    eq(tacos.confidence, "high", "plain: confidence high");
  }

  // --- fixture 2: @graph, type array, HowToSection, totalTime only ------------------
  const lasagna = extractRecipeFromJsonLd(read("graph-sections.html"));
  assert(lasagna, "graph fixture yields a draft (Recipe found inside @graph with array @type)");
  if (lasagna) {
    eq(lasagna.title, "Sunday Lasagna", "graph: title");
    eq(lasagna.description, "The slow one for a lazy weekend.", "graph: description tags stripped");
    eq(lasagna.prep_minutes, 45, "graph: prep minutes");
    eq(lasagna.cook_minutes, 90, "graph: cook derived from total - prep");
    eq(lasagna.servings, 8, "graph: numeric yield from array");
    eq(lasagna.tags, ["italian", "pasta", "make ahead"], "graph: keywords array");
    eq(lasagna.complexity, "hard", "graph: 135 minutes is hard");
    const lines = lasagna.instructions.split("\n");
    eq(lines[0], "Make the sauce:", "graph: section heading kept");
    eq(lines[1], "1. Brown the beef with the onion and garlic.", "graph: first step");
    eq(lines[3], "Assemble:", "graph: second section heading");
    eq(lines[6], "5. Bake at 375°F for 45 minutes, rest 15, top with basil.", "graph: numbering continues across sections");
    eq(lasagna.ingredients[1], { name: "onion", quantity: 1, unit: null, note: "large; diced", category: "produce" }, "graph: '1 large onion, diced'");
    eq(lasagna.ingredients[3], { name: "crushed tomatoes", quantity: 28, unit: "oz", note: null, category: "pantry" }, "graph: ounces -> oz, canned tomatoes are pantry");
    eq(lasagna.ingredients[10], { name: "nutmeg", quantity: null, unit: "pinch", note: null, category: "spices" }, "graph: pinch of nutmeg");
    eq(lasagna.ingredients.length, 16, "graph: all ingredient lines kept");
    eq(lasagna.ingredients[12], { name: "Italian sausage", quantity: 1, unit: "lb", note: null, category: "meat" }, "graph: 'lb.' with a period");
    eq(lasagna.ingredients[13], { name: "water", quantity: 2, unit: "cup", note: null, category: "other" }, "graph: 'c.' with a period");
    eq(lasagna.ingredients[14], { name: "olive oil", quantity: 3, unit: "tbsp", note: null, category: "pantry" }, "graph: 'Tbsp.' with a period");
    eq(lasagna.ingredients[15], { name: "red pepper flakes", quantity: 0.5, unit: "tsp", note: null, category: "spices" }, "graph: leading '.5'");
  }

  // --- fixture 4: a pre-numbered step in the middle --------------------------------
  const bread = extractRecipeFromJsonLd(read("prenumbered-steps.html"));
  assert(bread, "pre-numbered fixture yields a draft");
  if (bread) {
    eq(
      bread.instructions.split("\n").map((l) => l.split(".")[0]),
      ["1", "2", "3", "4", "5"],
      "pre-numbered: numbering continues after a step that keeps its own number",
    );
    eq(bread.servings, 6, "pre-numbered: 'Serves 6'");
    eq(bread.ingredients[1], { name: "butter", quantity: 4, unit: "tbsp", note: "softened", category: "dairy" }, "pre-numbered: '4 Tbsp. butter, softened'");
  }

  // --- fixture 3: no recipe --------------------------------------------------------
  const none = extractRecipeFromJsonLd(read("no-recipe.html"));
  eq(none, null, "no-recipe fixture yields null (Organization JSON-LD ignored)");
  const text = htmlToText(read("no-recipe.html"));
  assert(text.includes("made-up food blog"), "fallback text keeps the main content");
  assert(!text.includes("dataLayer") && !text.includes("color:"), "fallback text drops scripts and styles");
  assert(!text.includes("Home"), "fallback text drops nav");
  eq(pageTitle(read("no-recipe.html")), "About Fixture Kitchen", "page title");
  eq(decodeEntities("Mac &amp; cheese &#189; &#x00BD; &frac12;"), "Mac & cheese ½ ½ ½", "entity decoding");

  // --- URL guard ----------------------------------------------------------------------
  const rejects = (url: string, why: string) => {
    try {
      validateImportUrl(url);
      assert(false, `rejects ${why}`);
    } catch (e) {
      assert(e instanceof ImportUrlError, `rejects ${why}`);
    }
  };
  rejects("not a url", "garbage");
  rejects("ftp://example.com/recipe", "ftp");
  rejects("file:///etc/passwd", "file:");
  rejects("http://localhost:3000/", "localhost");
  rejects("http://127.0.0.1/", "loopback IP");
  rejects("http://10.1.2.3/", "10/8");
  rejects("http://192.168.1.1/", "192.168/16");
  rejects("http://172.20.0.1/", "172.16/12");
  rejects("http://169.254.169.254/latest/meta-data", "link-local / cloud metadata");
  rejects("http://[::1]/", "IPv6 loopback");
  rejects("http://[::ffff:7f00:1]/", "IPv4-mapped loopback in hex form");
  rejects("http://[0:0:0:0:0:ffff:a00:1]/", "IPv4-mapped 10.0.0.1, fully written out");
  rejects("http://[64:ff9b::a9fe:a9fe]/", "NAT64 of 169.254.169.254");
  rejects("http://[2002:c0a8:101::1]/", "6to4 of 192.168.1.1");
  rejects("http://[fd00::1]/", "IPv6 unique local");
  rejects("http://[::ffff:127.0.0.1]/", "IPv4-mapped loopback");
  rejects("http://intranet/", "bare hostname");
  rejects("http://printer.local/", ".local");
  rejects("http://user:pw@example.com/", "credentials in URL");
  eq(validateImportUrl("https://www.example.com/recipe#tips").toString(), "https://www.example.com/recipe", "accepts a public https URL and drops the fragment");
  eq(validateImportUrl("http://[2606:4700::1111]/").hostname, "[2606:4700::1111]", "accepts a public IPv6 literal");

  // Address classification by value, whatever the spelling.
  const privateCases = [
    "::", "::1", "::ffff:7f00:1", "0:0:0:0:0:ffff:a00:1", "::ffff:127.0.0.1", "::ffff:192.168.1.1",
    "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b:1::1", "2002:7f00:1::",
    "2002:0a00:0001::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1", "2001:db8::1",
    "100::1", "not-an-ip", "1::2::3",
  ];
  for (const ip of privateCases) assert(isPrivateAddress(ip), `${ip} is private or refused`);
  const publicCases = ["2606:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "2002:808:808::1", "2a00:1450::1", "8.8.8.8"];
  for (const ip of publicCases) assert(!isPrivateAddress(ip), `${ip} is public`);

  if (failures) {
    console.error(`\n${failures} import check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll import checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
