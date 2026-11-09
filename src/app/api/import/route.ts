import Anthropic from "@anthropic-ai/sdk";
import { ImportUrlError, importRecipeFromUrl, NoRecipeFoundError } from "@/lib/import";

/**
 * POST { url } → { draft, method, sourceUrl }.
 * "Start from a link" on /recipes/new. The page is fetched server-side with
 * the guards in src/lib/import/fetch.ts; the draft is the same shape the
 * photo endpoint returns, so the form pre-fills the same way.
 */
export async function POST(req: Request) {
  let url: unknown;
  try {
    ({ url } = (await req.json()) as { url?: unknown });
  } catch {
    return Response.json({ error: "Expected JSON with a url" }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "Paste a link first" }, { status: 400 });
  }

  try {
    const result = await importRecipeFromUrl(url);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ImportUrlError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof NoRecipeFoundError) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "Anthropic API key is invalid" }, { status: 500 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Rate limited by the model API. Try again shortly." }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: `Model API error: ${err.message}` }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Import failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
