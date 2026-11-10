import Anthropic from "@anthropic-ai/sdk";
import {
  analyzePlatePhoto,
  SUPPORTED_IMAGE_TYPES,
  type SupportedImageType,
} from "@/lib/ai/plate";
import { NotSignedInError, requireMember } from "@/lib/member";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST multipart/form-data with a `photo` file (and optional `hint` text).
 * Returns a recipe draft as JSON. The recipe form on /recipes/new uses this.
 */
export async function POST(req: Request) {
  // proxy.ts already answers 401 without a session cookie; this is the real check.
  try {
    await requireMember();
  } catch (err) {
    if (err instanceof NotSignedInError) {
      return Response.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const photo = form.get("photo");
  const hint = form.get("hint");
  if (!(photo instanceof File)) {
    return Response.json({ error: "Attach a photo" }, { status: 400 });
  }
  if (!SUPPORTED_IMAGE_TYPES.includes(photo.type as SupportedImageType)) {
    return Response.json(
      { error: `Unsupported image type "${photo.type}". Use JPEG, PNG, WebP, or GIF.` },
      { status: 415 },
    );
  }
  if (photo.size > MAX_BYTES) {
    return Response.json({ error: "Photo is too large (max 8 MB)" }, { status: 413 });
  }

  try {
    const base64 = Buffer.from(await photo.arrayBuffer()).toString("base64");
    const draft = await analyzePlatePhoto({
      base64,
      mediaType: photo.type as SupportedImageType,
      hint: typeof hint === "string" ? hint : undefined,
    });
    return Response.json({ draft });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "Anthropic API key is invalid" }, { status: 500 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Rate limited by the model API. Try again shortly." }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: `Model API error: ${err.message}` }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Analysis failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
