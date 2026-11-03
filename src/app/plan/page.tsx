import Link from "next/link";
import { Suspense } from "react";
import { clearMealAction, setMealAction } from "@/app/actions";
import { addDays, dayName, formatShort, isIsoDate, weekStart } from "@/lib/dates";
import { today as currentDate } from "@/lib/today";
import { complexityLabel, formatMinutes, totalMinutes } from "@/lib/format";
import { getPlan } from "@/lib/plan";
import { listRecipes } from "@/lib/recipes";

export const metadata = { title: "Plan" };

export default async function PlanPage(props: { searchParams: Promise<{ week?: string }> }) {
  const sp = await props.searchParams;
  const today = await currentDate();
  const start = sp.week && isIsoDate(sp.week) ? weekStart(sp.week) : weekStart(today);
  const end = addDays(start, 6);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Supper plan</h1>
        <div className="flex items-center gap-1 text-sm">
          <Link href={`/plan?week=${addDays(start, -7)}`} className="btn btn-secondary">
            ← Prev
          </Link>
          <Link href="/plan" className="btn btn-secondary">
            This week
          </Link>
          <Link href={`/plan?week=${addDays(start, 7)}`} className="btn btn-secondary">
            Next →
          </Link>
        </div>
      </div>
      <p className="text-sm text-stone-500">
        Week of {formatShort(start)} – {formatShort(end)}. A rough plan is fine; it&rsquo;s there so the
        grocery list writes itself.
      </p>

      <Suspense fallback={<p className="text-stone-500">Loading plan…</p>}>
        <WeekEditor start={start} today={today} />
      </Suspense>

      <div className="flex gap-2">
        <Link href={`/grocery?start=${start}&end=${end}`} className="btn btn-primary">
          Build grocery list for this week
        </Link>
      </div>
    </div>
  );
}

async function WeekEditor({ start, today }: { start: string; today: string }) {
  const [days, recipes] = await Promise.all([getPlan(start, 7), listRecipes()]);
  const byRating = [...recipes].sort(
    (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title),
  );

  return (
    <div className="space-y-2">
      {days.map((day) => {
        const isToday = day.date === today;
        const recipe = day.meal?.recipe ?? null;
        return (
          <form
            key={day.date}
            action={setMealAction}
            className={`card flex flex-col gap-2 sm:flex-row sm:items-center ${isToday ? "border-amber-300 bg-amber-50/50" : ""}`}
          >
            <input type="hidden" name="date" value={day.date} />
            <div className="w-28 shrink-0">
              <div className="font-medium">{dayName(day.date)}</div>
              <div className="text-xs text-stone-500">{formatShort(day.date)}{isToday ? " · today" : ""}</div>
            </div>
            <select name="recipeId" defaultValue={day.meal?.recipeId ?? "__none__"} className="input flex-1">
              <option value="__none__">— no recipe —</option>
              {byRating.map((r) => {
                const mins = totalMinutes(r);
                return (
                  <option key={r.id} value={r.id}>
                    {r.title}
                    {mins != null ? ` · ${formatMinutes(mins)}` : ""} · {complexityLabel[r.complexity].toLowerCase()}
                    {r.rating ? ` · ${"★".repeat(r.rating)}` : ""}
                  </option>
                );
              })}
            </select>
            <input
              name="note"
              defaultValue={day.meal?.note ?? ""}
              placeholder="or a note: leftovers, eat out…"
              className="input sm:w-56"
            />
            <div className="flex gap-1">
              <button className="btn btn-primary">Set</button>
              {day.meal ? (
                <button className="btn btn-secondary" formAction={clearMealAction}>
                  Clear
                </button>
              ) : null}
            </div>
            {recipe ? (
              <Link href={`/recipes/${recipe.id}`} className="text-xs text-stone-500 hover:underline sm:ml-2">
                view
              </Link>
            ) : null}
          </form>
        );
      })}
    </div>
  );
}
