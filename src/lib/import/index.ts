import type { RecipeDraft } from "@/lib/ai/draft";
import { draftRecipeFromPageText } from "@/lib/ai/web";
import { fetchRecipePage } from "./fetch";
import { htmlToText, pageTitle } from "./html";
import { extractRecipeFromJsonLd } from "./jsonld";

export { ImportUrlError, validateImportUrl } from "./fetch";

export type ImportMethod = "jsonld" | "claude";

export type ImportResult = {
  draft: RecipeDraft;
  method: ImportMethod;
  /** The page we actually read (after redirects); goes in the form's Source URL. */
  sourceUrl: string;
};

export class NoRecipeFoundError extends Error {
  constructor(message = "No recipe found on that page. Try the photo option or type it in.") {
    super(message);
    this.name = "NoRecipeFoundError";
  }
}

/**
 * Paste a link, get a draft. Structured data first (free, exact), then Claude
 * over the page text when an API key is available, otherwise a clear error.
 */
export async function importRecipeFromUrl(rawUrl: string): Promise<ImportResult> {
  const page = await fetchRecipePage(rawUrl);

  const fromJsonLd = extractRecipeFromJsonLd(page.html);
  if (fromJsonLd && (fromJsonLd.ingredients.length || fromJsonLd.instructions)) {
    return { draft: fromJsonLd, method: "jsonld", sourceUrl: page.finalUrl };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new NoRecipeFoundError(
      "No recipe data found on that page. Set ANTHROPIC_API_KEY to let Claude read pages like this one, or try the photo option or type it in.",
    );
  }

  const text = htmlToText(page.html);
  if (text.length < 80) throw new NoRecipeFoundError();
  const draft = await draftRecipeFromPageText({ url: page.finalUrl, title: pageTitle(page.html), text });
  if (!draft.ingredients.length && draft.confidence === "low") {
    throw new NoRecipeFoundError();
  }
  return { draft, method: "claude", sourceUrl: page.finalUrl };
}
