"use client";

import { useActionState, useState } from "react";
import { saveRecipeAction, type ActionState } from "@/app/actions";
import { complexities, ingredientCategories, type Complexity, type IngredientCategory } from "@/db/schema";
import type { RecipeDraft } from "@/lib/ai/draft";
import type { ImportMethod } from "@/lib/import";
import { complexityLabel } from "@/lib/format";
import type { RecipeInput } from "@/lib/recipes";

export type IngredientFormValues = {
  name: string;
  quantity: string;
  unit: string;
  note: string;
  category: IngredientCategory;
};

export type RecipeFormValues = {
  title: string;
  description: string;
  sourceUrl: string;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  complexity: Complexity;
  rating: number | null;
  tags: string;
  instructions: string;
  notes: string;
  ingredients: IngredientFormValues[];
};

const EMPTY_INGREDIENT: IngredientFormValues = {
  name: "",
  quantity: "",
  unit: "",
  note: "",
  category: "other",
};

const EMPTY: RecipeFormValues = {
  title: "",
  description: "",
  sourceUrl: "",
  servings: 4,
  prepMinutes: null,
  cookMinutes: null,
  complexity: "medium",
  rating: null,
  tags: "",
  instructions: "",
  notes: "",
  ingredients: [{ ...EMPTY_INGREDIENT }, { ...EMPTY_INGREDIENT }, { ...EMPTY_INGREDIENT }],
};

function toPayload(v: RecipeFormValues, source?: string): RecipeInput {
  return {
    title: v.title,
    description: v.description || null,
    sourceUrl: v.sourceUrl || null,
    source,
    servings: v.servings,
    prepMinutes: v.prepMinutes,
    cookMinutes: v.cookMinutes,
    complexity: v.complexity,
    rating: v.rating,
    tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean),
    instructions: v.instructions || null,
    notes: v.notes || null,
    ingredients: v.ingredients
      .filter((i) => i.name.trim())
      .map((i) => ({
        name: i.name,
        quantity: i.quantity.trim() ? parseQuantity(i.quantity) : null,
        unit: i.unit || null,
        note: i.note || null,
        category: i.category,
      })),
  };
}

/** Accepts "1 1/2", "3/4", "2", "0.5". */
function parseQuantity(raw: string): number | null {
  const s = raw.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Shown above the form after a draft lands: where it came from and what to double-check. */
type DraftNotice = { heading: string; items: string[] };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the page";
  }
}

export function RecipeForm({
  recipeId,
  initial,
  photoEnabled,
}: {
  recipeId: string | null;
  initial?: RecipeFormValues;
  photoEnabled: boolean;
}) {
  const [values, setValues] = useState<RecipeFormValues>(initial ?? EMPTY);
  const [source, setSource] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<DraftNotice | null>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveRecipeAction.bind(null, recipeId),
    null,
  );

  const set = <K extends keyof RecipeFormValues>(key: K, value: RecipeFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const setIngredient = (index: number, patch: Partial<IngredientFormValues>) =>
    setValues((v) => ({
      ...v,
      ingredients: v.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)),
    }));

  /** Pre-fill the form from a draft, whichever "start from …" path produced it. */
  const applyDraft = (draft: RecipeDraft, meta: { source: string; sourceUrl?: string; notice: DraftNotice | null }) => {
    setValues({
      title: draft.title,
      description: draft.description,
      sourceUrl: meta.sourceUrl ?? "",
      servings: draft.servings,
      prepMinutes: draft.prep_minutes,
      cookMinutes: draft.cook_minutes,
      complexity: draft.complexity,
      rating: null,
      tags: draft.tags.join(", "),
      instructions: draft.instructions,
      notes: "",
      ingredients: draft.ingredients.length
        ? draft.ingredients.map((i) => ({
            name: i.name,
            quantity: i.quantity == null ? "" : String(Math.round(i.quantity * 1000) / 1000),
            unit: i.unit ?? "",
            note: i.note ?? "",
            category: i.category,
          }))
        : [{ ...EMPTY_INGREDIENT }],
    });
    setSource(meta.source);
    setNotice(meta.notice);
  };

  const applyPhotoDraft = (draft: RecipeDraft) =>
    applyDraft(draft, {
      source: "photo",
      notice: draft.assumptions.length
        ? { heading: "The photo analysis guessed at a few things. Double-check:", items: draft.assumptions }
        : null,
    });

  const applyLinkDraft = (result: { draft: RecipeDraft; method: ImportMethod; sourceUrl: string }) => {
    const host = hostOf(result.sourceUrl);
    const items =
      result.method === "jsonld"
        ? [
            `Read the recipe data ${host} publishes for search engines, so quantities and steps are the site's own.`,
            "Units, store aisles and the effort level were worked out automatically. Give them a once-over.",
          ]
        : [
            `${host} has no recipe data, so Claude read the page text and drafted this. Compare it against the page.`,
            ...result.draft.assumptions,
          ];
    applyDraft(result.draft, {
      source: "web",
      sourceUrl: result.sourceUrl,
      notice: { heading: `Imported from ${host}.`, items },
    });
  };

  const err = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      {recipeId === null ? (
        <div className="grid gap-4 md:grid-cols-2">
          <LinkImporter onDraft={applyLinkDraft} />
          <PlateAnalyzer enabled={photoEnabled} onDraft={applyPhotoDraft} />
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="draft-notice">
          <p className="font-medium">{notice.heading}</p>
          {notice.items.length ? (
            <ul className="mt-1 list-disc pl-5">
              {notice.items.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {state?.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>
      ) : null}

      <input type="hidden" name="payload" value={JSON.stringify(toPayload(values, source))} />

      <section className="card space-y-3">
        <Field label="Title" error={err.title}>
          <input className="input" value={values.title} onChange={(e) => set("title", e.target.value)} required />
        </Field>
        <Field label="Description">
          <textarea
            className="input"
            rows={2}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What is it, and why does the family like it?"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Prep (min)">
            <input
              className="input"
              type="number"
              min={0}
              value={values.prepMinutes ?? ""}
              onChange={(e) => set("prepMinutes", numOrNull(e.target.value))}
            />
          </Field>
          <Field label="Cook (min)">
            <input
              className="input"
              type="number"
              min={0}
              value={values.cookMinutes ?? ""}
              onChange={(e) => set("cookMinutes", numOrNull(e.target.value))}
            />
          </Field>
          <Field label="Effort">
            <select
              className="input"
              value={values.complexity}
              onChange={(e) => set("complexity", e.target.value as Complexity)}
            >
              {complexities.map((c) => (
                <option key={c} value={c}>
                  {complexityLabel[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Serves">
            <input
              className="input"
              type="number"
              min={1}
              value={values.servings ?? ""}
              onChange={(e) => set("servings", numOrNull(e.target.value))}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Family rating">
            <select
              className="input"
              value={values.rating ?? ""}
              onChange={(e) => set("rating", numOrNull(e.target.value))}
            >
              <option value="">Not rated yet</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)} {n === 5 ? "Everyone loved it" : n === 1 ? "Never again" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tags (comma separated)">
            <input
              className="input"
              value={values.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="chicken, weeknight, mexican"
            />
          </Field>
        </div>
        <Field label="Source URL" error={err.sourceUrl}>
          <input
            className="input"
            type="url"
            value={values.sourceUrl}
            onChange={(e) => set("sourceUrl", e.target.value)}
            placeholder="https://"
          />
        </Field>
      </section>

      <section className="card space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Ingredients</h2>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => set("ingredients", [...values.ingredients, { ...EMPTY_INGREDIENT }])}
          >
            + Add line
          </button>
        </div>
        <p className="text-xs text-stone-500">
          List everything, including pantry basics, so the grocery list comes out complete.
        </p>
        <div className="hidden grid-cols-[4rem_5rem_1fr_1fr_7rem_2rem] gap-2 text-xs font-medium text-stone-500 sm:grid">
          <span>Qty</span>
          <span>Unit</span>
          <span>Ingredient</span>
          <span>Note</span>
          <span>Aisle</span>
          <span />
        </div>
        {values.ingredients.map((ing, i) => (
          <div key={i} className="grid grid-cols-[4rem_5rem_1fr_2rem] gap-2 sm:grid-cols-[4rem_5rem_1fr_1fr_7rem_2rem]">
            <input
              className="input"
              placeholder="1 1/2"
              value={ing.quantity}
              onChange={(e) => setIngredient(i, { quantity: e.target.value })}
              aria-label="Quantity"
            />
            <input
              className="input"
              placeholder="cup"
              value={ing.unit}
              onChange={(e) => setIngredient(i, { unit: e.target.value })}
              aria-label="Unit"
            />
            <input
              className="input"
              placeholder="ingredient"
              value={ing.name}
              onChange={(e) => setIngredient(i, { name: e.target.value })}
              aria-label="Ingredient"
            />
            <button
              type="button"
              className="btn btn-secondary px-2 sm:order-last"
              onClick={() => set("ingredients", values.ingredients.filter((_, j) => j !== i))}
              aria-label="Remove ingredient"
            >
              ×
            </button>
            <input
              className="input col-span-3 sm:col-span-1"
              placeholder="diced, optional…"
              value={ing.note}
              onChange={(e) => setIngredient(i, { note: e.target.value })}
              aria-label="Note"
            />
            <select
              className="input col-span-3 sm:col-span-1"
              value={ing.category}
              onChange={(e) => setIngredient(i, { category: e.target.value as IngredientCategory })}
              aria-label="Store section"
            >
              {ingredientCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <Field label="Steps (one per line)">
          <textarea
            className="input font-mono text-xs"
            rows={8}
            value={values.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            placeholder={"1. Heat oven to 400°F.\n2. ..."}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className="input"
            rows={2}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Kids want it without onions. Doubles well."
          />
        </Field>
      </section>

      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : recipeId ? "Save changes" : "Save recipe"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

function PlateAnalyzer({
  enabled,
  onDraft,
}: {
  enabled: boolean;
  onDraft: (draft: RecipeDraft) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("photo", file);
      if (hint.trim()) body.append("hint", hint.trim());
      const res = await fetch("/api/plate", { method: "POST", body });
      const json = (await res.json()) as { draft?: RecipeDraft; error?: string };
      if (!res.ok || !json.draft) throw new Error(json.error ?? "Analysis failed");
      onDraft(json.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card border-dashed">
      <h2 className="font-semibold">Start from a photo</h2>
      <p className="mt-1 text-sm text-stone-600">
        Snap a picture of a plate and the app will draft the recipe and ingredient list for you to tidy up.
      </p>
      {!enabled ? (
        <p className="mt-2 text-xs text-amber-700">
          Set <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code> to turn this on.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-stone-600">Photo</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              capture="environment"
              className="block w-full text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-stone-600">Anything to add? (optional)</span>
            <input
              className="input"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="from the Thai place on Main St"
            />
          </label>
          <button type="button" className="btn btn-secondary" onClick={analyze} disabled={!file || busy}>
            {busy ? "Looking…" : "Work out the recipe"}
          </button>
        </div>
      )}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </section>
  );
}

function LinkImporter({
  onDraft,
}: {
  onDraft: (result: { draft: RecipeDraft; method: ImportMethod; sourceUrl: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importUrl() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = (await res.json()) as {
        draft?: RecipeDraft;
        method?: ImportMethod;
        sourceUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.draft || !json.method || !json.sourceUrl) {
        throw new Error(json.error ?? "Import failed");
      }
      onDraft({ draft: json.draft, method: json.method, sourceUrl: json.sourceUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card border-dashed">
      <h2 className="font-semibold">Start from a link</h2>
      <p className="mt-1 text-sm text-stone-600">
        Paste a recipe page and the app will pull out the ingredients and steps for you to tidy up.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-stone-600">Recipe URL</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void importUrl();
              }
            }}
            placeholder="https://example.com/best-chili"
            aria-label="Recipe URL"
          />
        </label>
        <button type="button" className="btn btn-secondary" onClick={importUrl} disabled={!url.trim() || busy}>
          {busy ? "Fetching…" : "Fetch the recipe"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-red-700" role="alert" data-testid="import-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
