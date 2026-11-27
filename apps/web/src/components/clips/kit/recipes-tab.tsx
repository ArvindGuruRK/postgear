'use client';

/**
 * The kit page's Recipes tab (Module 10 section 2):
 *
 * - **Starter Recipes**: the five built in, read-only cards (the name, its
 *   help line, the line reading its settings back, a Built In badge) with
 *   **Duplicate**, which copies one into the workspace's own to change.
 * - **My Recipes**: the workspace's own, newest first, each with the line
 *   reading its settings back, who made it, **Rename** (a small dialog) and
 *   **Delete Recipe** (a red confirm naming it), and the count against the
 *   limit ("3 of 50 recipes"). None yet is an `EmptyState` saying where
 *   recipes come from (the editor's menu).
 *
 * The card line is the API's `description` (the engine's `describeRecipe`,
 * worked out once on the server for every recipe it answers).
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  EmptyState,
  MotionIcon,
  Skeleton,
  toast,
} from '@postgear/ui';
import { type RecipeView, starterRecipe } from '@postgear/video-engine';
import { BookOpen, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NOTE } from '@/components/studio/panel-ui';
import { ApiError } from '@/lib/api';
import { deleteRecipe, duplicateRecipe, listRecipes, updateRecipe } from '@/lib/clips-recipes-api';
import type { RecipesView } from '@/types/clips-recipes';
import { NameDialog } from '../layouts/name-dialog';
import {
  cleanRecipeName,
  deleteRecipeSentence,
  madeByLine,
  NO_RECIPES_HELP,
  NO_RECIPES_SENTENCE,
  RECIPE_ACTION_FAILED,
  RECIPE_NAME_EMPTY,
  RECIPE_NAME_MAX,
  RECIPES_FAILED,
  recipeCountLine,
} from './kit-model';

type RecipesState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; view: RecipesView };

function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.message ? cause.message : RECIPE_ACTION_FAILED;
}

export function RecipesTab({ initial }: { initial: RecipesView | null }) {
  const [state, setState] = useState<RecipesState>(
    initial ? { status: 'ready', view: initial } : { status: 'loading' },
  );
  const [attempt, setAttempt] = useState(initial ? 0 : 1);
  const [renaming, setRenaming] = useState<RecipeView | null>(null);
  const [deleting, setDeleting] = useState<RecipeView | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  useEffect(() => {
    if (attempt === 0) return;
    const abort = new AbortController();
    setState({ status: 'loading' });
    listRecipes({ signal: abort.signal })
      .then((view) => {
        if (!abort.signal.aborted) setState({ status: 'ready', view });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ status: 'failed' });
      });
    return () => abort.abort();
  }, [attempt]);

  const update = (change: (view: RecipesView) => RecipesView) =>
    setState((current) =>
      current.status === 'ready' ? { status: 'ready', view: change(current.view) } : current,
    );

  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-4" data-testid="clip-kit-recipes-loading">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <Alert variant="warning" className="items-center" data-testid="clip-kit-recipes-failed">
        <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        <p className="m-0 min-w-0 flex-1">{RECIPES_FAILED}</p>
        <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Try Again
        </Button>
      </Alert>
    );
  }

  const { view } = state;
  const starters = view.recipes.filter((recipe) => recipe.builtIn);
  const own = view.recipes.filter((recipe) => !recipe.builtIn);
  const full = view.own >= view.max;

  const duplicate = async (recipe: RecipeView) => {
    if (duplicating) return;
    setDuplicating(recipe.id);
    try {
      const copy = await duplicateRecipe(recipe.id);
      update((current) => ({
        ...current,
        recipes: [
          ...current.recipes.filter((one) => one.builtIn),
          copy,
          ...current.recipes.filter((one) => !one.builtIn),
        ],
        own: current.own + 1,
      }));
      toast({ title: `"${copy.name}" is in your recipes.` });
    } catch (cause) {
      toast({ title: sentenceOf(cause), variant: 'danger' });
    } finally {
      setDuplicating(null);
    }
  };

  const rename = async (value: string): Promise<string | null> => {
    const target = renaming;
    if (!target) return null;
    const name = cleanRecipeName(value);
    if (!name) return RECIPE_NAME_EMPTY;
    if (name === target.name) return null;
    try {
      const saved = await updateRecipe(target.id, { name });
      update((current) => ({
        ...current,
        recipes: current.recipes.map((one) => (one.id === saved.id ? saved : one)),
      }));
      return null;
    } catch (cause) {
      return sentenceOf(cause);
    }
  };

  const drop = (id: string) =>
    update((current) => ({
      ...current,
      recipes: current.recipes.filter((one) => one.id !== id),
      own: Math.max(0, current.own - 1),
    }));

  const confirmDelete = async () => {
    const target = deleting;
    if (!target || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const { message } = await deleteRecipe(target.id);
      drop(target.id);
      toast({ title: message });
      setDeleting(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        // Someone else deleted it first: it is gone either way.
        drop(target.id);
        setDeleting(null);
      }
      toast({ title: sentenceOf(cause), variant: 'danger' });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="clip-kit-starters" className="flex flex-col gap-3">
        <h2 id="clip-kit-starters" className="m-0 type-heading text-lg text-ink">
          Starter Recipes
        </h2>
        <ul
          className="m-0 grid list-none grid-cols-2 gap-4 p-0 xl:grid-cols-3 2xl:grid-cols-5"
          data-testid="clip-kit-starters"
        >
          {starters.map((recipe) => (
            <li key={recipe.id} className="flex min-w-0">
              <Card
                className="flex min-w-0 flex-1 flex-col gap-2 p-4"
                data-testid="clip-kit-starter"
                data-recipe={recipe.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="m-0 min-w-0 type-heading text-base text-ink">{recipe.name}</h3>
                  <Badge variant="outline" className="shrink-0">
                    Built In
                  </Badge>
                </div>
                {starterRecipe(recipe.id)?.help ? (
                  <p className={NOTE}>{starterRecipe(recipe.id)?.help}</p>
                ) : null}
                <p className="m-0 rounded-md bg-inset px-2 py-1.5 font-sans text-sm text-ink">
                  {recipe.description}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-auto self-start"
                  disabled={full || duplicating !== null}
                  onClick={() => void duplicate(recipe)}
                  aria-label={`Duplicate ${recipe.name}`}
                >
                  <MotionIcon icon={CopyIcon} className="h-4 w-4" />
                  Duplicate
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="clip-kit-own" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="clip-kit-own" className="m-0 type-heading text-lg text-ink">
            My Recipes
          </h2>
          <p className={NOTE} data-testid="clip-kit-recipe-count">
            {recipeCountLine(view.own, view.max)}
          </p>
        </div>
        {own.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={NO_RECIPES_SENTENCE}
            description={NO_RECIPES_HELP}
            data-testid="clip-kit-no-recipes"
          />
        ) : (
          <ul
            className="m-0 grid list-none grid-cols-2 gap-4 p-0 xl:grid-cols-3"
            data-testid="clip-kit-own-recipes"
          >
            {own.map((recipe) => {
              const madeBy = madeByLine(recipe.createdByName);
              return (
                <li key={recipe.id} className="flex min-w-0">
                  <Card
                    className="flex min-w-0 flex-1 flex-col gap-2 p-4"
                    data-testid="clip-kit-recipe"
                    data-recipe={recipe.id}
                  >
                    <h3 className="m-0 min-w-0 truncate type-heading text-base text-ink">
                      {recipe.name}
                    </h3>
                    <p className="m-0 rounded-md bg-inset px-2 py-1.5 font-sans text-sm text-ink">
                      {recipe.description}
                    </p>
                    {madeBy ? <p className={NOTE}>{madeBy}</p> : null}
                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setRenaming(recipe)}
                        aria-label={`Rename ${recipe.name}`}
                      >
                        <MotionIcon icon={PencilIcon} className="h-4 w-4" />
                        Rename
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleting(recipe)}
                        aria-label={`Delete Recipe ${recipe.name}`}
                      >
                        <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                        Delete Recipe
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <NameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename Recipe"
        description="The new name shows for everyone in this workspace."
        label="Recipe name"
        placeholder="Enter your recipe name"
        initial={renaming?.name ?? ''}
        maxLength={RECIPE_NAME_MAX}
        submitLabel="Save"
        busyLabel="Saving"
        onSubmit={rename}
        testId="clip-kit-rename-dialog"
      />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? deleteRecipeSentence(deleting.name) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={deleteBusy}
              data-testid="clip-kit-delete-confirm"
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleteBusy ? 'Deleting' : 'Delete Recipe'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
