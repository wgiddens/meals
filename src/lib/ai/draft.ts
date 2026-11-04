import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { complexities, ingredientCategories } from "@/db/schema";

/**
 * The one recipe-draft shape every "start from …" path produces. The photo
 * flow (`plate.ts`), the URL import (`src/lib/import`) and the Claude
 * fallback for pages without structured data (`web.ts`) all return this, and
 * `RecipeForm` knows how to pre-fill itself from it.
 */
export const recipeDraftSchema = z.object({
  title: z.string().describe("Short name for the dish, as a home cook would call it"),
  description: z.string().describe("One or two sentences describing the dish"),
  confidence: z.enum(["high", "medium", "low"]).describe("How sure you are about the recipe"),
  servings: z.number().int().describe("Servings the recipe makes"),
  prep_minutes: z.number().int(),
  cook_minutes: z.number().int(),
  complexity: z.enum(complexities),
  tags: z
    .array(z.string())
    .describe("3-6 lowercase tags: cuisine, protein, style, e.g. 'mexican', 'chicken', 'weeknight'"),
  ingredients: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable().describe("Numeric amount, or null if 'to taste'"),
      unit: z.string().nullable().describe("e.g. 'cup', 'tbsp', 'lb', 'clove'; null for countable items"),
      note: z.string().nullable().describe("Prep note such as 'diced' or 'optional'"),
      category: z.enum(ingredientCategories),
    }),
  ),
  instructions: z.string().describe("Numbered steps, one per line, written for a home cook"),
  assumptions: z.array(z.string()).describe("Things you guessed that the cook should double-check"),
});

/** What the model returns: every number filled in. */
export type ModelRecipeDraft = z.infer<typeof recipeDraftSchema>;

/**
 * What the app passes around. Same shape, but a draft built from a web page
 * may honestly not know servings or timing, so those are nullable here.
 */
export type RecipeDraft = Omit<ModelRecipeDraft, "servings" | "prep_minutes" | "cook_minutes"> & {
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
};

export type RecipeDraftIngredient = RecipeDraft["ingredients"][number];

export const DRAFT_MODEL = "claude-opus-5-5";

export function assertApiKey(feature: string): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(`ANTHROPIC_API_KEY is not set. Add it to .env.local to enable ${feature}.`);
  }
}

/**
 * Ask Claude for a recipe draft. Shared by the photo and web-page paths so
 * they use the same model, output schema and refusal handling.
 */
export async function requestRecipeDraft(input: {
  system: string;
  content: Anthropic.ContentBlockParam[];
  /** Shown when the model refuses or returns nothing usable. */
  subject: string;
}): Promise<ModelRecipeDraft> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: DRAFT_MODEL,
    max_tokens: 16000,
    system: input.system,
    messages: [{ role: "user", content: input.content }],
    output_config: {
      effort: "medium",
      format: zodOutputFormat(recipeDraftSchema),
    },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `The model declined to work on this ${input.subject}${
        response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."
      }`,
    );
  }
  if (!response.parsed_output) {
    throw new Error(`Could not read a recipe out of the model's response. Try another ${input.subject}.`);
  }
  return response.parsed_output;
}
