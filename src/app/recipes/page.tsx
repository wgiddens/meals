import Link from "next/link";
import { Suspense } from "react";
import { RecipeCard } from "@/components/RecipeCard";
import { complexities } from "@/db/schema";
import { complexityLabel } from "@/lib/format";
import { allTags, listRecipes, type RecipeFilter } from "@/lib/recipes";

export const metadata = { title: "Recipes" };

type Search = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function RecipesPage(props: { searchParams: Promise<Search> }) {
  const sp = await props.searchParams;
  const filter: RecipeFilter = {
    query: first(sp.q) || undefined,
    maxMinutes: Number(first(sp.max)) || undefined,
    complexity: (complexities as readonly string[]).includes(first(sp.complexity))
      ? (first(sp.complexity) as RecipeFilter["complexity"])
      : undefined,
    tag: first(sp.tag) || undefined,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recipes</h1>
        <Link href="/recipes/new" className="btn btn-primary">
          + Add recipe
        </Link>
      </div>

      <form className="card grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]" method="get">
        <input
          name="q"
          defaultValue={filter.query ?? ""}
          placeholder="Search title, ingredient, tag…"
          className="input"
        />
        <select name="max" defaultValue={first(sp.max)} className="input sm:w-36">
          <option value="">Any time</option>
          <option value="20">≤ 20 min</option>
          <option value="30">≤ 30 min</option>
          <option value="45">≤ 45 min</option>
          <option value="60">≤ 1 hour</option>
        </select>
        <select name="complexity" defaultValue={first(sp.complexity)} className="input sm:w-36">
          <option value="">Any effort</option>
          {complexities.map((c) => (
            <option key={c} value={c}>
              {complexityLabel[c]}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary">Filter</button>
        {filter.tag ? <input type="hidden" name="tag" value={filter.tag} /> : null}
      </form>

      <Suspense fallback={<p className="text-stone-500">Loading recipes…</p>}>
        <RecipeList filter={filter} />
      </Suspense>
    </div>
  );
}

async function RecipeList({ filter }: { filter: RecipeFilter }) {
  const [rows, tags] = await Promise.all([listRecipes(filter), allTags()]);
  return (
    <>
      {tags.length ? (
        <div className="flex flex-wrap gap-1">
          <Link
            href="/recipes"
            className={`chip ${!filter.tag ? "bg-stone-900 text-white" : "hover:bg-stone-200"}`}
          >
            all
          </Link>
          {tags.map((t) => (
            <Link
              key={t}
              href={`/recipes?tag=${encodeURIComponent(t)}`}
              className={`chip ${filter.tag === t ? "bg-stone-900 text-white" : "hover:bg-stone-200"}`}
            >
              {t}
            </Link>
          ))}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="card text-center text-stone-500">
          <p>No recipes match.</p>
          <p className="mt-1 text-sm">
            Try a different filter, or{" "}
            <Link href="/recipes/new" className="underline">
              add one
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </div>
      )}
    </>
  );
}
