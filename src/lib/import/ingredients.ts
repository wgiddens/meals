import type { IngredientCategory } from "@/db/schema";
import { normalizeUnit } from "@/lib/format";
import type { RecipeDraftIngredient } from "@/lib/ai/draft";

/**
 * Best-effort parse of a free-text ingredient line ("1 ½ cups flour, sifted")
 * into the app's ingredient shape. Users tidy the result in the form, so the
 * goal is "never drop information", not perfection: anything that cannot be
 * read becomes a name-only line.
 */

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join("");

/** One number: "2", "1.5", "1/2", "1 1/2", "1½", "½". */
const NUMBER = `(?:\\d+(?:[.,]\\d+)?(?:\\s*[${FRACTION_CHARS}]|\\s+\\d+/\\d+|/\\d+)?|[${FRACTION_CHARS}])`;
/** A number or a range: "1-2", "1 to 2", "1 – 2". */
const QUANTITY_RE = new RegExp(`^(${NUMBER})(?:\\s*(?:-|–|—|to)\\s*(${NUMBER}))?(?=\\s|$|[a-zA-Z(])`, "u");

function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  // "1½" / "1 ½" / "½"
  const uni = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)?\\s*([${FRACTION_CHARS}])$`, "u"));
  if (uni) return Number(uni[1] ?? 0) + UNICODE_FRACTIONS[uni[2]];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Units we recognise at the front of a line. Values are what `normalizeUnit`
 * will not already collapse; the map is keyed by every spelling we accept.
 */
const UNIT_WORDS = new Set([
  "cup", "cups", "c",
  "tablespoon", "tablespoons", "tbsp", "tbsps", "tbs", "tbl", "T",
  "teaspoon", "teaspoons", "tsp", "tsps", "t",
  "ounce", "ounces", "oz", "fl oz", "fluid ounce", "fluid ounces",
  "pound", "pounds", "lb", "lbs",
  "gram", "grams", "g", "kilogram", "kilograms", "kg",
  "milliliter", "milliliters", "millilitre", "millilitres", "ml",
  "liter", "liters", "litre", "litres", "l",
  "quart", "quarts", "qt", "pint", "pints", "pt", "gallon", "gallons", "gal",
  "clove", "cloves", "can", "cans", "jar", "jars", "bottle", "bottles",
  "package", "packages", "pkg", "packet", "packets", "bag", "bags", "box", "boxes",
  "slice", "slices", "piece", "pieces", "stick", "sticks", "head", "heads",
  "bunch", "bunches", "sprig", "sprigs", "stalk", "stalks", "rib", "ribs",
  "pinch", "pinches", "dash", "dashes", "handful", "handfuls", "ear", "ears",
  "fillet", "fillets", "filet", "filets", "sheet", "sheets", "drop", "drops",
  "large", "medium", "small",
]);

/** Size words are kept as a note rather than a unit ("2 large eggs"). */
const SIZE_WORDS = new Set(["large", "medium", "small"]);

const UNIT_ALIASES: Record<string, string> = {
  tbl: "tbsp",
  tbsps: "tbsp",
  T: "tbsp",
  t: "tsp",
  tsps: "tsp",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  qt: "quart",
  quarts: "quart",
  pints: "pint",
  pt: "pint",
  gallons: "gallon",
  gal: "gallon",
  jars: "jar",
  bottles: "bottle",
  packets: "packet",
  bags: "bag",
  boxes: "box",
  sticks: "stick",
  heads: "head",
  bunches: "bunch",
  sprigs: "sprig",
  stalks: "stalk",
  ribs: "rib",
  pinches: "pinch",
  dashes: "dash",
  handfuls: "handful",
  ears: "ear",
  fillets: "fillet",
  filet: "fillet",
  filets: "fillet",
  sheets: "sheet",
  drops: "drop",
  millilitre: "ml",
  millilitres: "ml",
  litre: "l",
  litres: "l",
};

function canonicalUnit(word: string): string {
  const exact = UNIT_ALIASES[word];
  if (exact) return exact;
  const lower = word.toLowerCase();
  return UNIT_ALIASES[lower] ?? normalizeUnit(lower);
}

export type ParsedIngredientLine = {
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
};

export function parseIngredientLine(raw: string): ParsedIngredientLine {
  let s = raw.replace(/\s+/g, " ").trim();
  const notes: string[] = [];

  // Pull out parenthetical remarks: "1 (14 oz) can tomatoes" -> note "14 oz".
  s = s.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    if (inner.trim()) notes.push(inner.trim());
    return " ";
  }).replace(/\s+/g, " ").trim();

  // Leading bullets or list markers.
  s = s.replace(/^[-*•▢☐]\s*/, "");

  let quantity: number | null = null;
  const q = s.match(QUANTITY_RE);
  if (q) {
    const low = parseNumber(q[1]);
    const high = q[2] ? parseNumber(q[2]) : null;
    if (low != null) {
      quantity = low;
      if (high != null && high !== low) notes.unshift(`${q[1].trim()}–${q[2].trim()}`);
    }
    s = s.slice(q[0].length).trim();
  }

  let unit: string | null = null;
  // Try a two-word unit first ("fl oz"), then one word.
  const words = s.split(" ");
  const two = words.slice(0, 2).join(" ");
  const one = words[0] ?? "";
  const candidate = UNIT_WORDS.has(two.toLowerCase()) ? two : UNIT_WORDS.has(one) || UNIT_WORDS.has(one.toLowerCase()) ? one : null;
  if (candidate && (quantity != null || !SIZE_WORDS.has(candidate.toLowerCase()))) {
    const rest = s.slice(candidate.length).trim();
    // "2 large eggs": keep "large" as a note, not a unit.
    if (SIZE_WORDS.has(candidate.toLowerCase())) {
      notes.push(candidate.toLowerCase());
      s = rest;
    } else if (rest || quantity != null) {
      // Only treat "t"/"T"/"c"/"l" style abbreviations as units when a number precedes them.
      if (candidate.length > 1 || quantity != null) {
        unit = canonicalUnit(candidate);
        s = rest;
      }
    }
  }

  // "cups of flour" -> "flour"
  s = s.replace(/^of\s+/i, "");

  // Trailing note after the first comma: "onion, diced" / "salt, to taste".
  let name = s;
  const comma = s.indexOf(",");
  if (comma > 0) {
    name = s.slice(0, comma).trim();
    const after = s.slice(comma + 1).trim();
    if (after) notes.push(after);
  }
  // "salt to taste" / "pepper as needed" with no comma.
  const trailing = name.match(/^(.*?)\s+(to taste|as needed|or to taste|for serving|for garnish|optional)$/i);
  if (trailing && trailing[1]) {
    name = trailing[1].trim();
    notes.push(trailing[2].toLowerCase());
  }

  name = name.replace(/[.;:]+$/, "").trim();
  if (!name) {
    // Nothing readable; keep the whole original line as the name.
    return { name: raw.trim(), quantity: null, unit: null, note: null };
  }

  const note = notes.map((n) => n.replace(/[.;:]+$/, "").trim()).filter(Boolean).join("; ");
  return { name, quantity, unit, note: note || null };
}

/**
 * Grocery aisle from the ingredient name. Rules are checked in order, so the
 * specific ones ("chicken broth" is pantry) come before the generic ones
 * ("chicken" is meat).
 */
const CATEGORY_RULES: Array<[RegExp, IngredientCategory]> = [
  [/\bfrozen\b|ice cream|popsicle|\bpuff pastry\b|\bphyllo\b/i, "frozen"],
  // Pantry versions of things that would otherwise match meat/dairy/produce.
  [/\b(broth|stock|bouillon)\b/i, "pantry"],
  [/\b(powder|flakes|seasoning|spice|extract|dried|ground (cumin|coriander|ginger|cinnamon|cloves|nutmeg|allspice|turmeric|mustard|cardamom))\b/i, "spices"],
  [/\b(coconut milk|coconut cream|evaporated milk|condensed milk|almond milk|oat milk|soy milk|peanut butter|almond butter|cocoa|chocolate chips|cream of (mushroom|chicken|celery) soup|tomato (paste|sauce|puree|purée)|crushed tomatoes|diced tomatoes|canned|\bcan of\b|sun-dried)\b/i, "pantry"],
  [/\b(salt|black pepper|white pepper|peppercorns?|cayenne|paprika|cumin|coriander seed|cinnamon|nutmeg|oregano|thyme|rosemary|bay lea(f|ves)|chili powder|chile powder|curry powder|turmeric|cardamom|cloves?|allspice|red pepper flakes|italian seasoning|garam masala|five.spice|vanilla|sesame seeds?|poppy seeds?|mustard seeds?|fennel seeds?|celery seed|za'?atar|sumac|saffron|msg)\b/i, "spices"],
  [/\b(shrimp|prawns?|salmon|tuna|cod|tilapia|halibut|trout|mahi|snapper|fish|crab|lobster|scallops?|clams?|mussels?|oysters?|anchov(y|ies)|calamari|squid)\b/i, "seafood"],
  [/\b(chicken|beef|pork|bacon|sausage|turkey|lamb|veal|ham|steak|brisket|ribs?|chops?|ground (beef|turkey|pork|chicken|lamb)|chuck|sirloin|tenderloin|prosciutto|pancetta|salami|pepperoni|chorizo|hot dogs?|meatballs?|mince)\b/i, "meat"],
  [/\b(milk|butter|cheese|cream|yogurt|yoghurt|eggs?|parmesan|mozzarella|cheddar|feta|ricotta|gouda|brie|gruy[eè]re|monterey jack|pecorino|mascarpone|cr[eè]me fra[iî]che|half.and.half|buttermilk|ghee|queso|paneer)\b/i, "dairy"],
  [/\b(bread|buns?|rolls?|tortillas?|pita|baguette|naan|bagels?|croissants?|english muffins?|ciabatta|focaccia|brioche|crumbs|croutons?)\b/i, "bakery"],
  [/\b(onions?|garlic|tomato(es)?|peppers?|jalape[nñ]os?|lettuce|lemons?|limes?|oranges?|apples?|bananas?|berries|strawberr(y|ies)|blueberr(y|ies)|potato(es)?|sweet potato(es)?|carrots?|celery|spinach|kale|cilantro|parsley|basil|mint|dill|chives|ginger|avocados?|mushrooms?|zucchini|squash|broccoli|cauliflower|cucumbers?|scallions?|green onions?|shallots?|leeks?|cabbage|corn|peas|green beans|asparagus|eggplant|aubergine|arugula|rocket|herbs?|fruit|vegetables?|mango|pineapple|grapes?|peach(es)?|pears?|plums?|cherries|melon|radish(es)?|beets?|turnips?|parsnips?|fennel|bok choy|sprouts|lemongrass|chil(i|e|li)(es)?)\b/i, "produce"],
  [/\b(wine|beer|juice|coffee|espresso|tea|soda|cola|sparkling water|club soda|cider|rum|vodka|whiskey|bourbon|brandy|tequila|sake|mirin)\b/i, "beverages"],
  [/\b(flour|sugar|oil|rice|pasta|spaghetti|penne|noodles?|beans?|lentils?|chickpeas|vinegar|soy sauce|fish sauce|worcestershire|hot sauce|sriracha|ketchup|mustard|mayonnaise|mayo|honey|maple syrup|molasses|oats|oatmeal|cereal|nuts?|almonds?|walnuts?|pecans?|peanuts?|cashews?|pine nuts|raisins?|dates|cornstarch|corn starch|baking (soda|powder)|yeast|breadcrumbs|panko|crackers?|chips|salsa|olives?|capers|pickles?|jam|jelly|chocolate|quinoa|couscous|tahini|miso|curry paste|coconut|stock cube|tortilla chips|sauce|syrup|dressing|broth)\b/i, "pantry"],
];

export function guessCategory(name: string): IngredientCategory {
  for (const [re, category] of CATEGORY_RULES) {
    if (re.test(name)) return category;
  }
  return "other";
}

/** Parse a free-text ingredient line into the draft shape, aisle included. */
export function toDraftIngredient(line: string): RecipeDraftIngredient {
  const parsed = parseIngredientLine(line);
  return { ...parsed, category: guessCategory(parsed.name) };
}
