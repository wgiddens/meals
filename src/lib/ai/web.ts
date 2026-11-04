import { assertApiKey, requestRecipeDraft, type ModelRecipeDraft } from "./draft";

/**
 * Fallback for the URL import: the page had no schema.org Recipe data, so we
 * hand Claude the readable text and ask for the same structured draft the
 * photo path produces. Unlike the photo prompt, this one is told to copy, not
 * to cook: only what is on the page, never an invented quantity.
 */

const SYSTEM_PROMPT = `You help a family keep a recipe book. You are given the readable text of a
web page that may contain a recipe. Extract that recipe into the structured
draft format.

Rules:
- Extract only what is on the page. Never invent a quantity, an ingredient or
  a step that is not written there. If a quantity is missing, use null.
- Keep the page's own wording for ingredient names and steps, lightly tidied.
- Put prep notes ("diced", "optional", "divided") in the ingredient's note.
- Assign each ingredient the grocery-store category it would be found in.
- If the page gives no servings or timing, use 0 and say so in assumptions.
- Pick complexity from how long it takes and how many steps there are.
- If the page does not actually contain a recipe, set confidence to "low",
  return an empty ingredient list and explain in assumptions.
- List anything you had to guess in assumptions.`;

export const MAX_PAGE_TEXT_CHARS = 40_000;

export async function draftRecipeFromPageText(input: {
  url: string;
  title: string | null;
  text: string;
}): Promise<ModelRecipeDraft> {
  assertApiKey("importing recipes from pages without structured data");
  const text = input.text.slice(0, MAX_PAGE_TEXT_CHARS);
  const header = [`URL: ${input.url}`, input.title ? `Page title: ${input.title}` : null]
    .filter(Boolean)
    .join("\n");

  return requestRecipeDraft({
    system: SYSTEM_PROMPT,
    subject: "page",
    content: [
      {
        type: "text",
        text: `${header}\n\nPage text:\n<<<\n${text}\n>>>\n\nExtract the recipe from this page.`,
      },
    ],
  });
}
