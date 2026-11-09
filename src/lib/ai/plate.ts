import {
  assertApiKey,
  recipeDraftSchema,
  requestRecipeDraft,
  type ModelRecipeDraft,
} from "./draft";

/**
 * "Take a picture of a plate and figure out what you'd need to make it."
 *
 * Sends the photo to Claude and asks for a structured recipe draft: a title,
 * the ingredient list with rough quantities and store categories, timing, and
 * steps. The draft is meant to be reviewed and edited in the recipe form, not
 * saved blindly. The schema and the call itself live in `draft.ts` so the
 * URL import's Claude fallback produces the identical shape.
 */

export const plateAnalysisSchema = recipeDraftSchema;
export type PlateAnalysis = ModelRecipeDraft;

export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

const SYSTEM_PROMPT = `You help a family keep a recipe book and plan weeknight suppers.
Given a photo of a plate of food, work out what the dish is and write a
practical recipe for it that a home cook could follow to recreate it.

Guidelines:
- Scale the recipe for a family of 4-6.
- List every ingredient needed, including basics like oil, salt, and pepper,
  so a complete grocery list can be built from it.
- Give realistic quantities and the right grocery-store category for each item.
- Be honest about uncertainty: say what you assumed in "assumptions".
- Keep instructions concise and numbered.`;

export async function analyzePlatePhoto(input: {
  base64: string;
  mediaType: SupportedImageType;
  hint?: string;
}): Promise<PlateAnalysis> {
  assertApiKey("photo analysis");

  const userText = input.hint?.trim()
    ? `Here is a photo of a plate of food. Extra context from the cook: "${input.hint.trim()}". Work out the recipe.`
    : "Here is a photo of a plate of food. Work out the recipe.";

  return requestRecipeDraft({
    system: SYSTEM_PROMPT,
    subject: "photo",
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: input.mediaType, data: input.base64 },
      },
      { type: "text", text: userText },
    ],
  });
}
