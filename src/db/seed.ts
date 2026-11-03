/**
 * Seed a few family-style recipes so the app isn't empty on first run.
 *   npm run db:seed
 * Safe to re-run: it skips recipes whose title already exists.
 */
import { ilike } from "drizzle-orm";
import { getDb } from "./index";
import { recipes } from "./schema";
import { createRecipe, type RecipeInput } from "@/lib/recipes";

const SEED: RecipeInput[] = [
  {
    title: "Sheet Pan Chicken Fajitas",
    description: "Everything roasts on one pan. Set out tortillas and toppings and let everyone build their own.",
    source: "family",
    servings: 5,
    prepMinutes: 15,
    cookMinutes: 25,
    complexity: "easy",
    rating: 5,
    tags: ["mexican", "chicken", "weeknight", "sheet pan"],
    ingredients: [
      { name: "chicken breast", quantity: 2, unit: "lb", note: "sliced into strips", category: "meat" },
      { name: "bell peppers", quantity: 3, note: "sliced", category: "produce" },
      { name: "yellow onion", quantity: 1, note: "sliced", category: "produce" },
      { name: "olive oil", quantity: 3, unit: "tbsp", category: "pantry" },
      { name: "fajita seasoning", quantity: 3, unit: "tbsp", category: "spices" },
      { name: "lime", quantity: 1, category: "produce" },
      { name: "flour tortillas", quantity: 12, category: "bakery" },
      { name: "shredded cheddar", quantity: 1, unit: "cup", category: "dairy" },
      { name: "sour cream", quantity: 1, unit: "cup", category: "dairy" },
    ],
    instructions:
      "1. Heat oven to 425°F.\n2. Toss chicken, peppers and onion with oil and seasoning on a sheet pan.\n3. Roast 20-25 minutes, stirring once, until chicken is cooked through.\n4. Squeeze lime over the top. Warm tortillas and serve with cheese and sour cream.",
  },
  {
    title: "Spaghetti and Meat Sauce",
    description: "The reliable one. Makes enough for leftovers.",
    source: "family",
    servings: 6,
    prepMinutes: 10,
    cookMinutes: 30,
    complexity: "easy",
    rating: 4,
    tags: ["italian", "beef", "pasta", "weeknight", "leftovers"],
    ingredients: [
      { name: "ground beef", quantity: 1, unit: "lb", category: "meat" },
      { name: "yellow onion", quantity: 1, note: "diced", category: "produce" },
      { name: "garlic", quantity: 3, unit: "clove", note: "minced", category: "produce" },
      { name: "crushed tomatoes", quantity: 28, unit: "oz", note: "1 can", category: "pantry" },
      { name: "tomato paste", quantity: 2, unit: "tbsp", category: "pantry" },
      { name: "italian seasoning", quantity: 1, unit: "tbsp", category: "spices" },
      { name: "spaghetti", quantity: 1, unit: "lb", category: "pantry" },
      { name: "parmesan", quantity: 0.5, unit: "cup", note: "grated", category: "dairy" },
      { name: "olive oil", quantity: 1, unit: "tbsp", category: "pantry" },
      { name: "salt", quantity: null, note: "to taste", category: "spices" },
    ],
    instructions:
      "1. Brown the beef with onion in olive oil; add garlic for the last minute.\n2. Stir in tomatoes, paste and seasoning. Simmer 20 minutes.\n3. Cook spaghetti in salted water. Serve with sauce and parmesan.",
  },
  {
    title: "Slow Cooker Pulled Pork Sandwiches",
    description: "Ten minutes in the morning, supper is waiting when everyone gets home.",
    source: "family",
    servings: 8,
    prepMinutes: 10,
    cookMinutes: 480,
    complexity: "easy",
    rating: 5,
    tags: ["pork", "slow cooker", "sandwiches", "leftovers"],
    ingredients: [
      { name: "pork shoulder", quantity: 4, unit: "lb", category: "meat" },
      { name: "bbq rub", quantity: 3, unit: "tbsp", category: "spices" },
      { name: "chicken broth", quantity: 1, unit: "cup", category: "pantry" },
      { name: "bbq sauce", quantity: 1.5, unit: "cup", category: "pantry" },
      { name: "hamburger buns", quantity: 8, category: "bakery" },
      { name: "coleslaw mix", quantity: 14, unit: "oz", note: "1 bag", category: "produce" },
      { name: "coleslaw dressing", quantity: 0.5, unit: "cup", category: "pantry" },
    ],
    instructions:
      "1. Rub pork with seasoning, place in slow cooker with broth. Cook on low 8 hours.\n2. Shred, drain most of the liquid, stir in BBQ sauce.\n3. Toss slaw mix with dressing. Pile pork and slaw on buns.",
  },
  {
    title: "Chicken Stir Fry",
    description: "Fast, uses up whatever vegetables are in the drawer.",
    source: "family",
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 15,
    complexity: "medium",
    rating: 4,
    tags: ["asian", "chicken", "weeknight", "rice"],
    ingredients: [
      { name: "chicken thighs", quantity: 1.5, unit: "lb", note: "boneless, cut into bites", category: "meat" },
      { name: "broccoli", quantity: 1, unit: "head", note: "florets", category: "produce" },
      { name: "carrots", quantity: 2, note: "sliced thin", category: "produce" },
      { name: "garlic", quantity: 3, unit: "clove", note: "minced", category: "produce" },
      { name: "fresh ginger", quantity: 1, unit: "tbsp", note: "grated", category: "produce" },
      { name: "soy sauce", quantity: 0.33, unit: "cup", category: "pantry" },
      { name: "honey", quantity: 2, unit: "tbsp", category: "pantry" },
      { name: "cornstarch", quantity: 1, unit: "tbsp", category: "pantry" },
      { name: "vegetable oil", quantity: 2, unit: "tbsp", category: "pantry" },
      { name: "jasmine rice", quantity: 2, unit: "cup", category: "pantry" },
    ],
    instructions:
      "1. Start the rice.\n2. Whisk soy sauce, honey, cornstarch and 1/4 cup water.\n3. Sear chicken in oil over high heat until browned; remove.\n4. Stir fry vegetables 4 minutes, add garlic and ginger, return chicken, pour in sauce and cook until glossy.",
  },
  {
    title: "Taco Night",
    description: "Ground beef tacos. The kids' pick.",
    source: "family",
    servings: 5,
    prepMinutes: 10,
    cookMinutes: 15,
    complexity: "easy",
    rating: 5,
    tags: ["mexican", "beef", "weeknight", "kid favorite"],
    ingredients: [
      { name: "ground beef", quantity: 1.5, unit: "lb", category: "meat" },
      { name: "taco seasoning", quantity: 1, unit: "package", category: "spices" },
      { name: "taco shells", quantity: 12, category: "pantry" },
      { name: "shredded lettuce", quantity: 2, unit: "cup", category: "produce" },
      { name: "tomatoes", quantity: 2, note: "diced", category: "produce" },
      { name: "shredded cheddar", quantity: 1.5, unit: "cup", category: "dairy" },
      { name: "salsa", quantity: 1, unit: "cup", category: "pantry" },
      { name: "sour cream", quantity: 0.5, unit: "cup", category: "dairy" },
    ],
    instructions:
      "1. Brown beef, drain, stir in seasoning and 2/3 cup water. Simmer 5 minutes.\n2. Warm shells. Set out toppings.",
  },
  {
    title: "Homemade Chicken Pot Pie",
    description: "A weekend project. Worth it, but not a Tuesday.",
    source: "family",
    servings: 6,
    prepMinutes: 40,
    cookMinutes: 45,
    complexity: "hard",
    rating: 5,
    tags: ["chicken", "comfort food", "weekend", "baking"],
    ingredients: [
      { name: "chicken breast", quantity: 1.5, unit: "lb", note: "cooked and diced", category: "meat" },
      { name: "butter", quantity: 6, unit: "tbsp", category: "dairy" },
      { name: "yellow onion", quantity: 1, note: "diced", category: "produce" },
      { name: "carrots", quantity: 3, note: "diced", category: "produce" },
      { name: "celery", quantity: 2, unit: "stalk", note: "diced", category: "produce" },
      { name: "frozen peas", quantity: 1, unit: "cup", category: "frozen" },
      { name: "all-purpose flour", quantity: 0.33, unit: "cup", category: "pantry" },
      { name: "chicken broth", quantity: 2, unit: "cup", category: "pantry" },
      { name: "whole milk", quantity: 1, unit: "cup", category: "dairy" },
      { name: "pie crusts", quantity: 2, note: "refrigerated", category: "dairy" },
      { name: "salt", quantity: null, note: "to taste", category: "spices" },
      { name: "black pepper", quantity: null, note: "to taste", category: "spices" },
    ],
    instructions:
      "1. Heat oven to 400°F. Soften onion, carrot and celery in butter.\n2. Stir in flour, cook 1 minute, whisk in broth and milk until thick. Add chicken, peas, salt and pepper.\n3. Fill bottom crust, top with second crust, cut vents. Bake 40-45 minutes until golden.",
  },
  {
    title: "Breakfast for Supper",
    description: "Pancakes, eggs and bacon. Zero complaints.",
    source: "family",
    servings: 5,
    prepMinutes: 10,
    cookMinutes: 20,
    complexity: "easy",
    rating: 4,
    tags: ["breakfast", "kid favorite", "weeknight"],
    ingredients: [
      { name: "pancake mix", quantity: 2, unit: "cup", category: "pantry" },
      { name: "eggs", quantity: 10, category: "dairy" },
      { name: "bacon", quantity: 1, unit: "lb", category: "meat" },
      { name: "butter", quantity: 2, unit: "tbsp", category: "dairy" },
      { name: "maple syrup", quantity: 1, unit: "cup", category: "pantry" },
      { name: "whole milk", quantity: 1.5, unit: "cup", category: "dairy" },
    ],
    instructions:
      "1. Bake bacon on a sheet pan at 400°F for 18 minutes.\n2. Mix pancake batter per the box with milk and 2 eggs; cook on a griddle.\n3. Scramble the remaining eggs in butter. Serve with syrup.",
  },
  {
    title: "Grilled Salmon with Rice and Green Beans",
    description: "Quick, light, and good for a hot evening.",
    source: "family",
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    complexity: "medium",
    rating: 3,
    tags: ["seafood", "healthy", "grill", "weeknight"],
    ingredients: [
      { name: "salmon fillets", quantity: 1.5, unit: "lb", category: "seafood" },
      { name: "olive oil", quantity: 2, unit: "tbsp", category: "pantry" },
      { name: "lemon", quantity: 1, category: "produce" },
      { name: "green beans", quantity: 1, unit: "lb", note: "trimmed", category: "produce" },
      { name: "jasmine rice", quantity: 1.5, unit: "cup", category: "pantry" },
      { name: "garlic", quantity: 2, unit: "clove", note: "minced", category: "produce" },
      { name: "salt", quantity: null, note: "to taste", category: "spices" },
      { name: "black pepper", quantity: null, note: "to taste", category: "spices" },
    ],
    instructions:
      "1. Start the rice.\n2. Oil and season salmon; grill 4-5 minutes per side.\n3. Sauté green beans with garlic in olive oil until tender-crisp. Finish everything with lemon.",
  },
];

async function main() {
  const db = await getDb();
  let created = 0;
  for (const recipe of SEED) {
    const existing = await db.query.recipes.findFirst({
      where: ilike(recipes.title, recipe.title),
    });
    if (existing) continue;
    await createRecipe(recipe);
    created++;
  }
  console.log(`Seeded ${created} new recipe(s); ${SEED.length - created} already existed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
