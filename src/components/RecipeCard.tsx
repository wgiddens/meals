import Link from "next/link";
import type { RecipeWithIngredients } from "@/lib/recipes";
import { complexityLabel, formatMinutes, stars, totalMinutes } from "@/lib/format";

export function RecipeMeta({ recipe }: { recipe: RecipeWithIngredients }) {
  const mins = totalMinutes(recipe);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600">
      <span title="Total time">⏱ {formatMinutes(mins)}</span>
      <span title="Complexity">{complexityLabel[recipe.complexity]}</span>
      {recipe.rating ? (
        <span className="text-amber-500" title={`${recipe.rating}/5`}>
          {stars(recipe.rating)}
        </span>
      ) : null}
      {recipe.servings ? <span>Serves {recipe.servings}</span> : null}
    </div>
  );
}

export function RecipeCard({ recipe }: { recipe: RecipeWithIngredients }) {
  return (
    <Link
      href={`/recipes/${recipe.id}`}
      className="card block transition-shadow hover:shadow-md"
    >
      <h3 className="font-semibold">{recipe.title}</h3>
      {recipe.description ? (
        <p className="mt-1 line-clamp-2 text-sm text-stone-600">{recipe.description}</p>
      ) : null}
      <div className="mt-2">
        <RecipeMeta recipe={recipe} />
      </div>
      {recipe.tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {recipe.tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </Link>
  );
}
