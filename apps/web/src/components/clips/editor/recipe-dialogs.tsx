'use client';

/**
 * Save As Recipe and Apply A Recipe (Sprint 13, Module 10; blueprint
 * section 8), from the editor's top bar menu.
 *
 * - **Save As Recipe**: a name ("Enter your recipe name") and a read-back of
 *   exactly what will be saved: the engine's one line (`describeRecipe`)
 *   and a short list of the parts. A clip with a brand kit can keep it in
 *   the recipe. Saving at the workspace's limit (422 `recipe_limit`) says so
 *   in an Alert, and nothing typed is lost.
 * - **Apply A Recipe**: the five Starter Recipes, then the workspace's own,
 *   each with its line. Apply hands the recipe to the editor, which applies
 *   it as one undo step; a refusal stays in the dialog.
 */
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  FormLabel,
  Input,
  Skeleton,
  Spinner,
} from '@postgear/ui';
import {
  type ClipDocument,
  describeRecipe,
  type ExportQuality,
  RECIPE_NAME_MAX,
  type RecipeSettings,
  type RecipeView,
  recipeFromClip,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { createRecipe, listClipBrandKits, listRecipes } from '@/lib/clips-recipes-api';
import type { CaptionStyleView } from '@/types/clips';
import {
  APPLY_A_RECIPE,
  APPLY_RECIPE_HELP,
  KEEP_BRAND_KIT,
  NO_OWN_RECIPES,
  NOTHING_TO_SAVE,
  RECIPE_FAILED,
  RECIPE_NAME_LABEL,
  RECIPE_NAME_PLACEHOLDER,
  RECIPES_LOAD_FAILED,
  recipePartLines,
  SAVE_AS_RECIPE,
  SAVE_RECIPE_HELP,
} from './recipe-model';

const NOTE = 'm-0 font-sans text-xs text-ink type-muted';

function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : RECIPE_FAILED;
}

/** The engine's one line for a recipe, or the API's when the engine cannot say. */
export function recipeLine(recipe: Pick<RecipeView, 'description' | 'settings'>): string {
  if (recipe.description) return recipe.description;
  try {
    return describeRecipe(recipe.settings);
  } catch {
    return '';
  }
}

/** True when the settings hold anything besides their version. */
function hasParts(settings: RecipeSettings): boolean {
  return Object.keys(settings).some((key) => key !== 'version');
}

// Stable defaults: an inline object would be new on every render and rerun
// the effects that reset the dialog (the name box would empty on each key).
const SAVE_DEPS = { create: createRecipe, kits: listClipBrandKits };
const APPLY_DEPS = { list: listRecipes };

export function SaveRecipeDialog({
  open,
  onOpenChange,
  document,
  exportQuality,
  styles,
  onSaved,
  deps = SAVE_DEPS,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: ClipDocument;
  /** The Export tab's quality, saved with the recipe. */
  exportQuality?: ExportQuality;
  styles: readonly CaptionStyleView[];
  onSaved: (recipe: RecipeView) => void;
  deps?: { create: typeof createRecipe; kits: typeof listClipBrandKits };
}) {
  const [name, setName] = useState('');
  const [keepKit, setKeepKit] = useState(true);
  const [kitName, setKitName] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ text: string; limit: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  const kitId = useId();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // What will be saved, read from the clip as it is when the dialog opens.
  const read = useMemo(() => {
    if (!open) return null;
    try {
      const settings = recipeFromClip(document, exportQuality ? { exportQuality } : {});
      return { settings, line: recipeLine({ description: '', settings }) };
    } catch {
      return null;
    }
  }, [open, document, exportQuality]);
  const parts = read ? recipePartLines(read.settings, styles) : [];
  const brandKitId = document.brandKitId ?? null;

  // Each opening starts empty; the kit's name is read when the clip has one.
  useEffect(() => {
    if (!open) return;
    setName('');
    setKeepKit(true);
    setProblem(null);
    setBusy(false);
    setKitName(null);
    if (!brandKitId) return;
    const abort = new AbortController();
    deps
      .kits({ signal: abort.signal })
      .then((view) => {
        if (abort.signal.aborted) return;
        setKitName(view.brandKits.find((kit) => kit.id === brandKitId)?.name ?? null);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [open, brandKitId, deps]);

  const cleaned = name.replace(/\s+/g, ' ').trim();
  const canSave = !busy && cleaned.length > 0 && read !== null && hasParts(read.settings);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave || !read) return;
    setBusy(true);
    setProblem(null);
    try {
      const recipe = await deps.create({
        name: cleaned,
        settings: read.settings,
        brandKitId: brandKitId && keepKit ? brandKitId : null,
      });
      if (!live.current) return;
      onSaved(recipe);
      onOpenChange(false);
    } catch (cause) {
      if (!live.current) return;
      setProblem({
        text: sentenceOf(cause),
        limit: cause instanceof ApiError && cause.code === 'recipe_limit',
      });
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent data-testid="clip-save-recipe">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{SAVE_AS_RECIPE}</DialogTitle>
            <DialogDescription>{SAVE_RECIPE_HELP}</DialogDescription>
          </DialogHeader>

          <FormField>
            <FormLabel htmlFor={fieldId}>{RECIPE_NAME_LABEL}</FormLabel>
            <Input
              id={fieldId}
              value={name}
              maxLength={RECIPE_NAME_MAX}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder={RECIPE_NAME_PLACEHOLDER}
              autoFocus
              data-testid="clip-save-recipe-name"
            />
          </FormField>

          <div
            className="flex flex-col gap-2 rounded-md border-2 border-outline bg-inset p-3"
            data-testid="clip-save-recipe-readback"
          >
            {read && hasParts(read.settings) ? (
              <>
                {read.line ? (
                  <p className="m-0 font-sans text-sm font-bold text-ink">{read.line}</p>
                ) : null}
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                  {parts.map((part) => (
                    <li key={part} className="font-sans text-sm text-ink">
                      {part}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className={NOTE}>{NOTHING_TO_SAVE}</p>
            )}
          </div>

          {brandKitId ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={kitId}
                checked={keepKit}
                disabled={busy}
                onCheckedChange={(value) => setKeepKit(value === true)}
                data-testid="clip-save-recipe-kit"
              />
              <label htmlFor={kitId} className="font-sans text-sm text-ink">
                {kitName ? `${KEEP_BRAND_KIT} (${kitName})` : KEEP_BRAND_KIT}
              </label>
            </div>
          ) : null}

          {problem ? (
            <Alert
              variant={problem.limit ? 'warning' : 'danger'}
              className="items-center"
              data-testid="clip-save-recipe-problem"
              data-code={problem.limit ? 'recipe_limit' : undefined}
            >
              <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <p className="m-0 min-w-0 flex-1">{problem.text}</p>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave} data-testid="clip-save-recipe-submit">
              {busy ? <Spinner /> : null}
              {busy ? 'Saving' : 'Save Recipe'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ApplyRecipeDialog({
  open,
  onOpenChange,
  onApply,
  deps = APPLY_DEPS,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Applies it; null when it worked (the dialog closes), else the sentence to show. */
  onApply: (recipe: RecipeView) => Promise<string | null>;
  deps?: { list: typeof listRecipes };
}) {
  const [recipes, setRecipes] = useState<RecipeView[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [applying, setApplying] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    void reload;
    if (!open) return;
    setProblem(null);
    setLoadFailed(false);
    const abort = new AbortController();
    deps
      .list({ signal: abort.signal })
      .then((view) => {
        if (!abort.signal.aborted) setRecipes(view.recipes);
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoadFailed(true);
      });
    return () => abort.abort();
  }, [open, reload, deps]);

  const apply = useCallback(
    async (recipe: RecipeView) => {
      if (applying) return;
      setApplying(recipe.id);
      setProblem(null);
      const sentence = await onApply(recipe);
      if (!live.current) return;
      setApplying(null);
      if (sentence) setProblem(sentence);
      else onOpenChange(false);
    },
    [applying, onApply, onOpenChange],
  );

  const starters = recipes?.filter((recipe) => recipe.builtIn) ?? [];
  const own = recipes?.filter((recipe) => !recipe.builtIn) ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => applying === null && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="clip-apply-recipe">
        <DialogHeader>
          <DialogTitle>{APPLY_A_RECIPE}</DialogTitle>
          <DialogDescription>{APPLY_RECIPE_HELP}</DialogDescription>
        </DialogHeader>

        {loadFailed ? (
          <Alert variant="warning" className="items-center">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{RECIPES_LOAD_FAILED}</p>
            <Button variant="secondary" size="sm" onClick={() => setReload((value) => value + 1)}>
              Try Again
            </Button>
          </Alert>
        ) : recipes === null ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <RecipeGroup
              title="Starter Recipes"
              recipes={starters}
              applying={applying}
              onApply={apply}
            />
            <RecipeGroup
              title="My Recipes"
              recipes={own}
              applying={applying}
              onApply={apply}
              empty={NO_OWN_RECIPES}
            />
          </div>
        )}

        {problem ? (
          <Alert variant="danger" className="items-center" data-testid="clip-apply-recipe-problem">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{problem}</p>
          </Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RecipeGroup({
  title,
  recipes,
  applying,
  onApply,
  empty,
}: {
  title: string;
  recipes: readonly RecipeView[];
  applying: string | null;
  onApply: (recipe: RecipeView) => void;
  empty?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="m-0 type-heading text-base text-ink">
        {title}
      </h3>
      {recipes.length === 0 ? (
        empty ? (
          <p className={NOTE}>{empty}</p>
        ) : null
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {recipes.map((recipe) => (
            <li
              key={recipe.id}
              className="flex items-center gap-3 rounded-md border-2 border-outline bg-inset p-3"
              data-testid="clip-recipe-row"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate type-ui font-sans text-sm text-ink">{recipe.name}</span>
                <span className={NOTE}>{recipeLine(recipe)}</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={applying !== null}
                onClick={() => onApply(recipe)}
                aria-label={`Apply ${recipe.name}`}
              >
                {applying === recipe.id ? <Spinner /> : null}
                Apply
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
