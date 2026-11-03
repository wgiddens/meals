import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RecipeForm, type RecipeFormValues } from "@/components/RecipeForm";
import { getRecipe } from "@/lib/recipes";

export const metadata = { title: "Edit recipe" };

export default function EditRecipePage(props: { params: Promise<{ id: string }> }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit recipe</h1>
      <Suspense fallback={<p className="text-stone-500">Loading…</p>}>
        <Editor params={props.params} />
      </Suspense>
    </div>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipe = await getRecipe(id);
  if (!recipe) notFound();

  const initial: RecipeFormValues = {
    title: recipe.title,
    description: recipe.description ?? "",
    sourceUrl: recipe.sourceUrl ?? "",
    servings: recipe.servings,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    complexity: recipe.complexity,
    rating: recipe.rating,
    tags: recipe.tags.join(", "),
    instructions: recipe.instructions ?? "",
    notes: recipe.notes ?? "",
    ingredients: recipe.ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity == null ? "" : String(Number(i.quantity)),
      unit: i.unit ?? "",
      note: i.note ?? "",
      category: i.category,
    })),
  };

  return (
    <RecipeForm
      recipeId={recipe.id}
      initial={initial}
      photoEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}
