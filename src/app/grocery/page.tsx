import Link from "next/link";
import { Suspense } from "react";
import {
  addGroceryItemAction,
  buildGroceryListAction,
  removeGroceryItemAction,
  toggleGroceryItemAction,
} from "@/app/actions";
import { ingredientCategories } from "@/db/schema";
import { addDays, formatShort, isIsoDate, weekStart } from "@/lib/dates";
import { today as currentDate } from "@/lib/today";
import { formatItem, getCurrentList, groupByCategory } from "@/lib/grocery";

export const metadata = { title: "Groceries" };

export default async function GroceryPage(props: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const sp = await props.searchParams;
  const defaultStart = weekStart(await currentDate());
  const start = sp.start && isIsoDate(sp.start) ? sp.start : defaultStart;
  const end = sp.end && isIsoDate(sp.end) ? sp.end : addDays(start, 6);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Grocery list</h1>
        <form action={buildGroceryListAction} className="flex items-center gap-2">
          <input type="hidden" name="start" value={start} />
          <input type="hidden" name="end" value={end} />
          <button className="btn btn-primary">
            Build from plan ({formatShort(start)} – {formatShort(end)})
          </button>
        </form>
      </div>

      <Suspense fallback={<p className="text-stone-500">Loading list…</p>}>
        <ListView />
      </Suspense>
    </div>
  );
}

async function ListView() {
  const list = await getCurrentList();
  if (!list) {
    return (
      <div className="card text-center text-stone-500">
        <p>No list yet.</p>
        <p className="mt-1 text-sm">
          <Link href="/plan" className="underline">
            Plan some suppers
          </Link>{" "}
          and then build the list from the plan.
        </p>
      </div>
    );
  }

  const groups = groupByCategory(list.items);
  const remaining = list.items.filter((i) => !i.checked).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-500">
        Built from the plan for {formatShort(list.startDate)} – {formatShort(list.endDate)}.{" "}
        {remaining ? `${remaining} to go.` : "All done!"} Rebuilding keeps what you&rsquo;ve checked off
        and anything you added by hand.
      </p>

      {groups.map((group) => (
        <section key={group.category} className="card">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{group.category}</h2>
          <ul className="mt-2 divide-y divide-stone-100">
            {group.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 py-1.5">
                <form action={toggleGroceryItemAction} className="contents">
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="checked" value={item.checked ? "false" : "true"} />
                  <button
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border ${
                      item.checked ? "border-green-600 bg-green-600 text-white" : "border-stone-300 bg-white"
                    }`}
                    aria-label={item.checked ? "Uncheck" : "Check off"}
                  >
                    {item.checked ? "✓" : ""}
                  </button>
                </form>
                <span className={`flex-1 text-sm ${item.checked ? "text-stone-400 line-through" : ""}`}>
                  {formatItem(item)}
                  {item.forRecipes.length ? (
                    <span className="ml-2 text-xs text-stone-400">for {item.forRecipes.join(", ")}</span>
                  ) : item.source === "manual" ? (
                    <span className="ml-2 text-xs text-stone-400">added by hand</span>
                  ) : null}
                </span>
                <form action={removeGroceryItemAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <button className="text-stone-300 hover:text-red-600" aria-label="Remove">
                    ×
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <form action={addGroceryItemAction} className="card flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-stone-600">Add something else</span>
          <input name="name" className="input" placeholder="milk, paper towels…" required />
        </label>
        <label className="w-20">
          <span className="mb-1 block text-xs font-medium text-stone-600">Qty</span>
          <input name="quantity" className="input" type="number" min={0} step="any" />
        </label>
        <label className="w-24">
          <span className="mb-1 block text-xs font-medium text-stone-600">Unit</span>
          <input name="unit" className="input" placeholder="gal" />
        </label>
        <label className="w-32">
          <span className="mb-1 block text-xs font-medium text-stone-600">Aisle</span>
          <select name="category" className="input" defaultValue="other">
            {ingredientCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-secondary">Add</button>
      </form>
    </div>
  );
}
