import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { deleteRecipeAction, setMealAction } from "@/app/actions";
import { RecipeMeta } from "@/components/RecipeCard";
import { addDays, dayName, formatShort } from "@/lib/dates";
import { today as currentDate } from "@/lib/today";
import { formatIngredient, formatMinutes } from "@/lib/format";
import { getRecipe } from "@/lib/recipes";

export default function RecipePage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-stone-500">Loading recipe…</p>}>
      <RecipeDetail params={props.params} />
    </Suspense>
  );
}

async function RecipeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipe = await getRecipe(id);
  if (!recipe) notFound();

  const today = await currentDate();
  const upcoming = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const steps = (recipe.instructions ?? "")
    .split(/\n+/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);

  return (
    <article className="space-y-6">
      <div>
        <Link href="/recipes" className="text-sm text-stone-500 hover:underline">
          ← All recipes
        </Link>
        <h1 className="mt-1 text-3xl font-semibold">{recipe.title}</h1>
        {recipe.description ? <p className="mt-2 text-stone-700">{recipe.description}</p> : null}
        <div className="mt-3">
          <RecipeMeta recipe={recipe} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-stone-500">
          {recipe.prepMinutes != null ? <span>Prep {formatMinutes(recipe.prepMinutes)}</span> : null}
          {recipe.cookMinutes != null ? <span>Cook {formatMinutes(recipe.cookMinutes)}</span> : null}
          {recipe.sourceUrl ? (
            <a href={recipe.sourceUrl} target="_blank" rel="noreferrer" className="underline">
              Source
            </a>
          ) : recipe.source ? (
            <span>Source: {recipe.source}</span>
          ) : null}
        </div>
        {recipe.tags.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {recipe.tags.map((t) => (
              <Link key={t} href={`/recipes?tag=${encodeURIComponent(t)}`} className="chip hover:bg-stone-200">
                {t}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_3fr]">
        <section className="card">
          <h2 className="font-semibold">Ingredients</h2>
          {recipe.ingredients.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {recipe.ingredients.map((ing) => (
                <li key={ing.id} className="flex gap-2">
                  <span className="text-stone-400">•</span>
                  <span>{formatIngredient(ing)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-stone-500">No ingredients listed yet.</p>
          )}
        </section>

        <section className="card">
          <h2 className="font-semibold">Steps</h2>
          {steps.length ? (
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-stone-500">No instructions yet.</p>
          )}
          {recipe.notes ? (
            <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-stone-700">
              <span className="font-medium">Notes:</span> {recipe.notes}
            </div>
          ) : null}
        </section>
      </div>

      <section className="card">
        <h2 className="font-semibold">Put it on the plan</h2>
        <form action={setMealAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="recipeId" value={recipe.id} />
          <select name="date" className="input w-auto" defaultValue={today}>
            {upcoming.map((d) => (
              <option key={d} value={d}>
                {d === today ? "Tonight" : dayName(d)} · {formatShort(d)}
              </option>
            ))}
          </select>
          <button className="btn btn-primary">Plan supper</button>
        </form>
      </section>

      <div className="flex gap-2">
        <Link href={`/recipes/${recipe.id}/edit`} className="btn btn-secondary">
          Edit
        </Link>
        <form action={deleteRecipeAction}>
          <input type="hidden" name="id" value={recipe.id} />
          <button className="btn btn-danger">Delete</button>
        </form>
      </div>
    </article>
  );
}
