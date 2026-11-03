import type { Complexity, Recipe, RecipeIngredient } from "@/db/schema";

/** "1.5" -> "1 1/2", "0.25" -> "1/4", "2" -> "2", null -> "" */
export function formatQuantity(q: string | number | null | undefined): string {
  if (q === null || q === undefined || q === "") return "";
  const n = typeof q === "string" ? Number(q) : q;
  if (!Number.isFinite(n)) return String(q);
  const whole = Math.floor(n);
  const frac = n - whole;
  const fractions: Array<[number, string]> = [
    [0.25, "1/4"],
    [0.333, "1/3"],
    [0.5, "1/2"],
    [0.667, "2/3"],
    [0.75, "3/4"],
  ];
  let fracStr = "";
  for (const [value, label] of fractions) {
    if (Math.abs(frac - value) < 0.04) {
      fracStr = label;
      break;
    }
  }
  if (fracStr) return whole ? `${whole} ${fracStr}` : fracStr;
  if (Math.abs(frac) < 0.001) return String(whole);
  return String(Math.round(n * 100) / 100);
}

export function formatIngredient(
  ing: Pick<RecipeIngredient, "name" | "quantity" | "unit" | "note">,
): string {
  const parts = [formatQuantity(ing.quantity), ing.unit, ing.name]
    .filter((p) => p && String(p).trim())
    .join(" ");
  return ing.note ? `${parts} (${ing.note})` : parts;
}

export function totalMinutes(
  r: Pick<Recipe, "prepMinutes" | "cookMinutes">,
): number | null {
  if (r.prepMinutes == null && r.cookMinutes == null) return null;
  return (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
}

export function formatMinutes(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export const complexityLabel: Record<Complexity, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Involved",
};

export function stars(rating: number | null): string {
  if (!rating) return "";
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

/** Make ingredient names comparable: lowercase, trimmed, singular-ish. */
export function normalizeName(name: string): string {
  let n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (n.endsWith("es") && n.length > 4 && /(ch|sh|ss|x|o)es$/.test(n)) {
    n = n.slice(0, -2);
  } else if (n.endsWith("s") && !n.endsWith("ss") && n.length > 3) {
    n = n.slice(0, -1);
  }
  return n;
}

export function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const u = unit.trim().toLowerCase().replace(/\.$/, "");
  const aliases: Record<string, string> = {
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    tbs: "tbsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    cups: "cup",
    c: "cup",
    ounce: "oz",
    ounces: "oz",
    pound: "lb",
    pounds: "lb",
    lbs: "lb",
    gram: "g",
    grams: "g",
    kilogram: "kg",
    kilograms: "kg",
    milliliter: "ml",
    milliliters: "ml",
    liter: "l",
    liters: "l",
    cloves: "clove",
    cans: "can",
    packages: "package",
    pkg: "package",
    slices: "slice",
    pieces: "piece",
  };
  return aliases[u] ?? u;
}
