import Link from "next/link";
import { Suspense } from "react";
import { toggleCookedAction } from "./actions";
import { RecipeMeta } from "@/components/RecipeCard";
import { dayName, formatShort } from "@/lib/dates";
import { today as currentDate } from "@/lib/today";
import { getCurrentList } from "@/lib/grocery";
import { getWeekPlan } from "@/lib/plan";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <Suspense fallback={<p className="text-stone-500">Loading tonight&rsquo;s supper…</p>}>
        <ThisWeek />
      </Suspense>
    </div>
  );
}

async function ThisWeek() {
  const today = await currentDate();
  const [week, list] = await Promise.all([getWeekPlan(today), getCurrentList()]);
  const tonight = week.find((d) => d.date === today) ?? null;
  const remaining = list ? list.items.filter((i) => !i.checked).length : 0;

  return (
    <>
      <section className="card border-stone-900/10 bg-gradient-to-br from-white to-amber-50">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
          Tonight · {dayName(today)}, {formatShort(today)}
        </p>
        {tonight?.meal?.recipe ? (
          <div className="mt-1">
            <Link href={`/recipes/${tonight.meal.recipe.id}`} className="text-2xl font-semibold hover:underline">
              {tonight.meal.recipe.title}
            </Link>
            <div className="mt-2">
              <RecipeMeta recipe={tonight.meal.recipe} />
            </div>
            {tonight.meal.note ? (
              <p className="mt-2 text-sm text-stone-600">Note: {tonight.meal.note}</p>
            ) : null}
            <form action={toggleCookedAction} className="mt-3">
              <input type="hidden" name="date" value={today} />
              <input type="hidden" name="cooked" value={tonight.meal.cooked ? "false" : "true"} />
              <button className={`btn ${tonight.meal.cooked ? "btn-secondary" : "btn-primary"}`}>
                {tonight.meal.cooked ? "✓ Cooked (undo)" : "Mark as cooked"}
              </button>
            </form>
          </div>
        ) : tonight?.meal?.note ? (
          <p className="mt-1 text-2xl font-semibold">{tonight.meal.note}</p>
        ) : (
          <div className="mt-1">
            <p className="text-2xl font-semibold text-stone-500">Nothing planned yet</p>
            <Link href="/plan" className="btn btn-primary mt-3">
              Plan tonight
            </Link>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">This week</h2>
          <Link href="/plan" className="text-sm text-stone-600 hover:underline">
            Edit plan →
          </Link>
        </div>
        <ol className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {week.map((day) => {
            const isToday = day.date === today;
            const past = day.date < today;
            return (
              <li
                key={day.date}
                className={`flex items-center gap-3 px-4 py-2.5 ${isToday ? "bg-amber-50" : ""} ${past ? "text-stone-400" : ""}`}
              >
                <span className="w-24 shrink-0 text-sm font-medium">
                  {dayName(day.date).slice(0, 3)}{" "}
                  <span className="font-normal text-stone-400">{formatShort(day.date)}</span>
                </span>
                <span className="flex-1 truncate text-sm">
                  {day.meal?.recipe ? (
                    <Link href={`/recipes/${day.meal.recipe.id}`} className="hover:underline">
                      {day.meal.recipe.title}
                    </Link>
                  ) : day.meal?.note ? (
                    <span className="italic">{day.meal.note}</span>
                  ) : (
                    <span className="text-stone-400">—</span>
                  )}
                </span>
                {day.meal?.cooked ? <span className="text-xs text-green-700">cooked</span> : null}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link href="/grocery" className="card hover:shadow-md">
          <h3 className="font-semibold">Grocery list</h3>
          <p className="mt-1 text-sm text-stone-600">
            {list
              ? remaining
                ? `${remaining} item${remaining === 1 ? "" : "s"} still to get`
                : "Everything checked off"
              : "No list yet. Build one from the plan."}
          </p>
        </Link>
        <Link href="/recipes/new" className="card hover:shadow-md">
          <h3 className="font-semibold">Add a recipe</h3>
          <p className="mt-1 text-sm text-stone-600">
            Type one in, or snap a photo of a plate and let the app work out the ingredients.
          </p>
        </Link>
      </section>
    </>
  );
}
