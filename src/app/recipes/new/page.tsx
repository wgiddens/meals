import { RecipeForm } from "@/components/RecipeForm";

export const metadata = { title: "New recipe" };

export default function NewRecipePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Add a recipe</h1>
      <RecipeForm recipeId={null} photoEnabled={Boolean(process.env.ANTHROPIC_API_KEY)} />
    </div>
  );
}
