import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { complexities, ingredientCategories } from "@/db/schema";

/**
 * "Take a picture of a plate and figure out what you'd need to make it."
 *
 * Sends the photo to Claude and asks for a structured recipe draft: a title,
 * the ingredient list with rough quantities and store categories, timing, and
 * steps. The draft is meant to be reviewed and edited in the recipe form, not
 * saved blindly.
 */

export const plateAnalysisSchema = z.object({
  title: z.string().describe("Short name for the dish, as a home cook would call it"),
  description: z
    .string()
    .describe("One or two sentences describing the dish as seen"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("How sure you are about what the dish is"),
  servings: z.number().int().describe("Servings the recipe below makes; 4-6 for a family"),
  prep_minutes: z.number().int(),
  cook_minutes: z.number().int(),
  complexity: z.enum(complexities),
  tags: z.array(z.string()).describe("3-6 lowercase tags: cuisine, protein, style, e.g. 'mexican', 'chicken', 'weeknight'"),
  ingredients: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable().describe("Numeric amount, or null if 'to taste'"),
      unit: z.string().nullable().describe("e.g. 'cup', 'tbsp', 'lb', 'clove'; null for countable items"),
      note: z.string().nullable().describe("Prep note such as 'diced' or 'optional'"),
      category: z.enum(ingredientCategories),
    }),
  ),
  instructions: z
    .string()
    .describe("Numbered steps, one per line, written for a home cook"),
  assumptions: z
    .array(z.string())
    .describe("Things you guessed that the cook should double-check"),
});

export type PlateAnalysis = z.infer<typeof plateAnalysisSchema>;

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
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable photo analysis.",
    );
  }
  const client = new Anthropic();

  const userText = input.hint?.trim()
    ? `Here is a photo of a plate of food. Extra context from the cook: "${input.hint.trim()}". Work out the recipe.`
    : "Here is a photo of a plate of food. Work out the recipe.";

  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mediaType,
              data: input.base64,
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
    output_config: {
      effort: "medium",
      format: zodOutputFormat(plateAnalysisSchema),
    },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `The model declined to analyze this photo${
        response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."
      }`,
    );
  }
  if (!response.parsed_output) {
    throw new Error("Could not read a recipe out of the model's response. Try another photo.");
  }
  return response.parsed_output;
}
