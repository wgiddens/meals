import type { Complexity } from "@/db/schema";
import type { RecipeDraft } from "@/lib/ai/draft";
import { cleanText, findJsonLdBlocks } from "./html";
import { toDraftIngredient } from "./ingredients";

/**
 * schema.org/Recipe from JSON-LD. Most recipe sites (and every WordPress
 * recipe plugin) publish one for Google, so this path works for the common
 * case with no API key at all.
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: Json | undefined): Json[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function typesOf(node: JsonObject): string[] {
  return asArray(node["@type"]).map((t) => String(t).toLowerCase().replace(/^https?:\/\/schema\.org\//, ""));
}

/** Walk a JSON-LD document (including `@graph` and nested lists) for Recipe nodes. */
function* recipeNodes(value: Json, depth = 0): Generator<JsonObject> {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    for (const v of value) yield* recipeNodes(v, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  if (typesOf(value).includes("recipe")) {
    yield value;
    return;
  }
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "hasPart"]) {
    if (key in value) yield* recipeNodes(value[key], depth + 1);
  }
}

/** Parse every JSON-LD block on the page and return the first Recipe node, if any. */
export function findRecipeJsonLd(html: string): JsonObject | null {
  for (const block of findJsonLdBlocks(html)) {
    let parsed: Json;
    try {
      parsed = JSON.parse(block) as Json;
    } catch {
      // Some sites leave stray HTML comments or trailing commas; try a light repair.
      try {
        parsed = JSON.parse(block.replace(/<!--[\s\S]*?-->/g, "").replace(/,\s*([}\]])/g, "$1")) as Json;
      } catch {
        continue;
      }
    }
    for (const node of recipeNodes(parsed)) return node;
  }
  return null;
}

/** "PT1H30M" -> 90. Also accepts days and fractional parts; returns null when unreadable. */
export function isoDurationToMinutes(value: Json | undefined): number | null {
  if (typeof value !== "string") return null;
  const m = value
    .trim()
    .toUpperCase()
    .match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return null;
  const [, d, h, min, s] = m;
  if (d === undefined && h === undefined && min === undefined && s === undefined) return null;
  const total = Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0) + Number(s ?? 0) / 60;
  return Math.round(total);
}

/** recipeYield can be 4, "4", "4 servings", "Serves 4", or an array of those. */
export function parseYield(value: Json | undefined): number | null {
  for (const v of asArray(value)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
    if (typeof v === "string") {
      const s = cleanText(v).toLowerCase();
      const lead = s.match(/^(\d+)/) ?? s.match(/^(?:serves|makes|yields?)\s*(?:about\s*)?(\d+)/);
      if (lead) return Number(lead[1]);
    }
  }
  return null;
}

function textOf(v: Json | undefined): string {
  if (typeof v === "string") return cleanText(v);
  if (typeof v === "number") return String(v);
  if (isObject(v)) {
    for (const key of ["text", "name", "@value"]) {
      if (typeof v[key] === "string") return cleanText(v[key] as string);
    }
  }
  return "";
}

/**
 * recipeInstructions: a string, a list of strings, HowToStep objects, or
 * HowToSection groups of steps. Flatten to numbered lines; sections keep a
 * heading line so "For the sauce" structure survives.
 */
export function instructionsToText(value: Json | undefined): string {
  const lines: string[] = [];
  let n = 0;
  const pushStep = (text: string) => {
    const t = text.trim();
    if (!t) return;
    // Lines that are already numbered ("1. Heat oven") keep their own number.
    lines.push(/^\d+[.)]\s/.test(t) ? t : `${++n}. ${t}`);
  };
  const walk = (v: Json | undefined, depth: number) => {
    if (v === undefined || v === null || depth > 5) return;
    if (typeof v === "string") {
      // One string may hold many steps separated by newlines or <li>/<p> tags.
      for (const part of cleanText(v).split("\n")) pushStep(part);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (!isObject(v)) return;
    const types = typesOf(v);
    if (types.includes("howtosection") || ("itemListElement" in v && !("text" in v))) {
      const heading = textOf(v["name"]);
      if (heading) lines.push(`${heading}:`);
      walk(v["itemListElement"], depth + 1);
      return;
    }
    pushStep(textOf(v));
  };
  walk(value, 0);
  return lines.join("\n");
}

function parseTags(node: JsonObject): string[] {
  const raw: string[] = [];
  for (const key of ["keywords", "recipeCategory", "recipeCuisine"]) {
    for (const v of asArray(node[key])) {
      if (typeof v === "string") raw.push(...v.split(","));
      else raw.push(textOf(v));
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const tag = cleanText(t).toLowerCase().trim();
    if (tag && tag.length <= 30 && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
    if (out.length >= 8) break;
  }
  return out;
}

export function guessComplexity(totalMinutes: number | null, stepCount: number): Complexity {
  if ((totalMinutes != null && totalMinutes >= 90) || stepCount >= 12) return "hard";
  if ((totalMinutes == null || totalMinutes <= 30) && stepCount <= 6) return "easy";
  return "medium";
}

/** Map a schema.org Recipe node to the app's draft shape. */
export function recipeNodeToDraft(node: JsonObject): RecipeDraft {
  const prep = isoDurationToMinutes(node["prepTime"]);
  const cook = isoDurationToMinutes(node["cookTime"]);
  const total = isoDurationToMinutes(node["totalTime"]);
  let prepMinutes = prep;
  let cookMinutes = cook;
  if (prepMinutes == null && total != null && cookMinutes != null) prepMinutes = Math.max(0, total - cookMinutes);
  if (cookMinutes == null && total != null) cookMinutes = Math.max(0, total - (prepMinutes ?? 0));

  const ingredientLines = asArray(node["recipeIngredient"] ?? node["ingredients"])
    .map((v) => textOf(v))
    .filter(Boolean);
  const instructions = instructionsToText(node["recipeInstructions"]);
  const stepCount = instructions.split("\n").filter((l) => /^\d+[.)]\s/.test(l)).length;

  const title = textOf(node["name"]) || textOf(node["headline"]) || "Untitled recipe";
  const description = textOf(node["description"]).slice(0, 600);

  return {
    title,
    description,
    confidence: "high",
    servings: parseYield(node["recipeYield"]),
    prep_minutes: prepMinutes,
    cook_minutes: cookMinutes,
    complexity: guessComplexity(
      prepMinutes == null && cookMinutes == null ? total : (prepMinutes ?? 0) + (cookMinutes ?? 0),
      stepCount,
    ),
    tags: parseTags(node),
    ingredients: ingredientLines.map(toDraftIngredient),
    instructions,
    assumptions: [],
  };
}

/** The whole JSON-LD path: HTML in, draft out (or null when the page has no Recipe). */
export function extractRecipeFromJsonLd(html: string): RecipeDraft | null {
  const node = findRecipeJsonLd(html);
  return node ? recipeNodeToDraft(node) : null;
}
