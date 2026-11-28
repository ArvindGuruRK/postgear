'use client';

/**
 * Clip Setup (Sprint 13, Module 05; blueprint section 2): choose the stretch,
 * say what to look for, the kind of video, the length and the shape, and read
 * the price in AI minutes before anything runs.
 *
 * The choices live in one reducer. Every change asks the API for the price
 * again (debounced, never a charge); the summary reads it back line by line
 * and the button carries the total. Too few AI minutes: the button is off and
 * the card says how many are needed and how many are left. **Find Clips**
 * starts the run and goes back to the video page, which follows its progress.
 *
 * Look For Action (Module 06) shows its price before it is switched on, and
 * says so when stills are shown to AI. Follow The Speaker (Module 08) is free,
 * shown for Vertical and Square only, and off while faces cannot be found.
 *
 * Module 10: the **Recipe** picker (None, the Starter Recipes, the
 * workspace's own) and the **Brand Kit** picker open the second card, with
 * the five starters as small tiles under them. Picking a recipe fills every
 * control it covers; a control changed afterwards shows a small dot, and
 * **Save As Recipe** appears under the picker once anything differs. Remove
 * Silences and Hook Title are free switches. The run carries the recipe's
 * and the kit's ids.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { BookmarkIcon } from '@animateicons/react/lucide/bookmark-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import {
  Alert,
  Button,
  ChoiceTiles,
  MotionIcon,
  PageActions,
  Segmented,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Spinner,
  SummaryBox,
  Textarea,
  Toggle,
} from '@postgear/ui';
import {
  CAPTION_STYLES,
  canFollow,
  type ClipLength,
  defaultClipSetup,
  formatClipLength,
  type Genre,
  RECIPE_NAME_MAX,
  type Ratio,
  type RecipeView,
  recipeFromSetup,
  STARTER_RECIPES,
  TRANSCRIPT_LANGUAGES,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useReducer, useState } from 'react';
import { AnalyticsPanel, PanelHeader } from '@/components/analytics/analytics-ui';
import { ActionLink } from '@/components/home/home-actions';
import { ApiError } from '@/lib/api';
import { priceClipSetup, startHighlights } from '@/lib/clips-api';
import { createRecipe, listClipBrandKits, listRecipes } from '@/lib/clips-recipes-api';
import type { ClipsHostedLane, ClipVideoDetail, SetupPriceView } from '@/types/clips';
import type { ClipBrandKitView } from '@/types/clips-recipes';
import { AiMinutesChip } from '../home/clips-meters';
import { NameDialog } from '../layouts/name-dialog';
import { clipErrorSentence } from '../library/clip-actions';
import { LanguageSelect } from '../panels/captions-panel';
import { AiPrivacyHint } from './ai-privacy-hint';
import { RangeControl } from './range-control';
import {
  CHANGED_MARK,
  changedControls,
  HOOK_TITLE_HELP,
  offersSaveAsRecipe,
  RECIPE_HELP,
  SETUP_RECIPE_PLACEHOLDER,
  SILENCES_HELP,
  type SetupControl,
  GENRE_HELP,
  GENRE_OPTIONS,
  HONEST_LINE,
  ACTION_HELP,
  ACTION_VISION_NOTE,
  actionPriceLabel,
  FOLLOW_HELP,
  FOLLOW_OFF_NOTE,
  LENGTH_OPTIONS,
  PAY_FOR_LOOKING,
  priceLines,
  RANGE_HELP,
  REQUEST_EXAMPLES,
  REQUEST_PLACEHOLDER,
  SETUP_RATIOS,
  setupButtonLabel,
  setupReducer,
  shortfallSentence,
  summaryLines,
} from './setup-model';

const NOTE = 'm-0 font-sans text-xs text-ink type-muted';
const LABEL = 'font-sans text-sm font-bold text-ink';
/** The price is asked for again this long after the last change. */
const PRICE_DELAY_MS = 300;
const NONE = 'none';

/** The five starters as the picker knows them before the list arrives (and if it never does). */
const STARTER_VIEWS: RecipeView[] = STARTER_RECIPES.map((starter) => ({
  id: starter.id,
  name: starter.name,
  description: starter.help,
  settings: starter.settings,
  builtIn: true,
  brandKitId: null,
  createdById: null,
  createdByName: null,
  createdAt: null,
  updatedAt: null,
}));

/** The small dot by a control the user changed after picking a recipe. */
function ChangedDot({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-actionPrimary"
      title={CHANGED_MARK}
      data-testid="clip-setup-changed"
    >
      <span className="sr-only">{CHANGED_MARK}</span>
    </span>
  );
}

export function SetupForm({
  orgId,
  detail,
  action = { available: false, vision: false },
  faces = false,
  hostedLane = null,
}: {
  orgId: string;
  detail: ClipVideoDetail;
  /** Module 06: Look For Action can run right now; `vision`: it also shows stills to AI. */
  action?: { available: boolean; vision: boolean };
  /** Module 08: faces can be found right now (`ai.faces` in the clips status), so Follow The Speaker can run. */
  faces?: boolean;
  /** Module 15: where long speech goes (`ai.hostedLane`), for the privacy hint beside the chip. */
  hostedLane?: ClipsHostedLane | null;
}) {
  const router = useRouter();
  const { video } = detail;
  const durationMs = video.durationMs ?? 0;
  const [setup, dispatch] = useReducer(setupReducer, durationMs, defaultClipSetup);
  const [initialSetup] = useState(() => defaultClipSetup(durationMs));
  // Module 10: the workspace's recipes (the starters first) and its brand kits.
  const [recipes, setRecipes] = useState<RecipeView[]>(STARTER_VIEWS);
  const [kits, setKits] = useState<ClipBrandKitView[]>([]);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [price, setPrice] = useState<SetupPriceView | null>(null);
  const [pricing, setPricing] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const ids = {
    language: useId(),
    genre: useId(),
    range: useId(),
    request: useId(),
    length: useId(),
    shape: useId(),
    captions: useId(),
    action: useId(),
    follow: useId(),
    style: useId(),
    summary: useId(),
    look: useId(),
    recipe: useId(),
    brandKit: useId(),
    starters: useId(),
    silences: useId(),
    hookTitle: useId(),
  };
  const videoHref = `/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(video.id)}`;

  // The price, again after every change (debounced; never a charge).
  useEffect(() => {
    const abort = new AbortController();
    setPricing(true);
    const timer = setTimeout(() => {
      priceClipSetup(video.id, setup, { signal: abort.signal })
        .then((view) => {
          if (abort.signal.aborted) return;
          setPrice(view);
          setPricing(false);
          setProblem(null);
        })
        .catch((cause) => {
          if (abort.signal.aborted) return;
          setPricing(false);
          setProblem(clipErrorSentence(cause));
        });
    }, PRICE_DELAY_MS);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [setup, video.id]);

  // The recipes and kits, once (a list that does not load leaves the starters and None).
  useEffect(() => {
    const abort = new AbortController();
    listRecipes({ signal: abort.signal })
      .then((view) => {
        if (!abort.signal.aborted && view.recipes.length > 0) setRecipes(view.recipes);
      })
      .catch(() => undefined);
    listClipBrandKits({ signal: abort.signal })
      .then((view) => {
        if (!abort.signal.aborted) setKits(view.brandKits);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);

  const picked = useMemo(
    () =>
      setup.recipeId ? (recipes.find((recipe) => recipe.id === setup.recipeId) ?? null) : null,
    [recipes, setup.recipeId],
  );
  const changed = useMemo(() => changedControls(setup, picked?.settings ?? null), [setup, picked]);
  const dot = (control: SetupControl) => <ChangedDot shown={changed.has(control)} />;
  const canSaveRecipe = offersSaveAsRecipe(setup, picked?.settings ?? null, initialSetup);
  const pickRecipe = useCallback(
    (id: string) => {
      const recipe = id === NONE ? null : (recipes.find((one) => one.id === id) ?? null);
      dispatch({
        type: 'recipe',
        recipe: recipe
          ? { id: recipe.id, settings: recipe.settings, brandKitId: recipe.brandKitId }
          : null,
      });
    },
    [recipes],
  );
  const saveRecipe = async (name: string): Promise<string | null> => {
    const cleaned = name.replace(/\s+/g, ' ').trim();
    if (!cleaned) return 'Enter a name for the recipe.';
    try {
      const recipe = await createRecipe({
        name: cleaned,
        settings: recipeFromSetup(setup, picked?.settings ?? null),
        brandKitId: setup.brandKitId,
      });
      setRecipes((current) => [...current, recipe]);
      dispatch({
        type: 'recipe',
        recipe: { id: recipe.id, settings: recipe.settings, brandKitId: recipe.brandKitId },
      });
      return null;
    } catch (cause) {
      return clipErrorSentence(cause);
    }
  };
  const starterRecipes = recipes.filter((recipe) => recipe.builtIn);
  const ownRecipes = recipes.filter((recipe) => !recipe.builtIn);

  const shortfall = shortfallSentence(price);
  const styleName = useMemo(
    () => CAPTION_STYLES.find((style) => style.id === setup.captions.styleId)?.name ?? null,
    [setup.captions.styleId],
  );

  const start = async () => {
    if (starting || shortfall || !price) return;
    setStarting(true);
    setProblem(null);
    try {
      await startHighlights(video.id, setup);
      router.push(videoHref);
    } catch (cause) {
      setProblem(
        cause instanceof ApiError && cause.code === 'highlights_running'
          ? 'We are already looking for clips in this video.'
          : clipErrorSentence(cause),
      );
      setStarting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="clip-setup">
      <PageActions className="justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ActionLink href={videoHref}>
            <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
            Video
          </ActionLink>
          <p
            className="m-0 min-w-0 truncate font-sans text-lg text-ink type-heading"
            title={video.title}
          >
            {video.title}
          </p>
          <span className="shrink-0 font-sans text-sm text-ink type-muted">
            {formatClipLength(durationMs)}
          </span>
        </div>
      </PageActions>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_22rem] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <AnalyticsPanel aria-labelledby={ids.range} className="flex flex-col gap-4 p-4">
            <PanelHeader id={ids.range} title="Video" />
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <span id={ids.language} className={LABEL}>
                  Spoken Language
                </span>
                <LanguageSelect
                  value={setup.language}
                  onChange={(language) => dispatch({ type: 'language', language })}
                  labelledBy={ids.language}
                  languages={TRANSCRIPT_LANGUAGES}
                  auto
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-2">
                  <span id={ids.genre} className={LABEL}>
                    Genre
                  </span>
                  {dot('genre')}
                </span>
                <Select
                  value={setup.genre}
                  onValueChange={(genre) => dispatch({ type: 'genre', genre: genre as Genre })}
                >
                  <SelectTrigger aria-labelledby={ids.genre} data-testid="clip-setup-genre">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENRE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className={NOTE}>{GENRE_HELP}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={LABEL}>Range</span>
              <RangeControl
                fromMs={setup.range.fromMs}
                toMs={setup.range.toMs}
                durationMs={durationMs}
                onChange={(fromMs, toMs) => dispatch({ type: 'range', fromMs, toMs })}
                testId="clip-setup-range"
              />
              <p className={NOTE}>{RANGE_HELP}</p>
            </div>
          </AnalyticsPanel>

          <AnalyticsPanel aria-labelledby={ids.look} className="flex flex-col gap-4 p-4">
            <PanelHeader id={ids.look} title="What To Make" />
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <span id={ids.recipe} className={LABEL}>
                  Recipe
                </span>
                <Select value={setup.recipeId ?? NONE} onValueChange={pickRecipe}>
                  <SelectTrigger aria-labelledby={ids.recipe} data-testid="clip-setup-recipe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    <SelectGroup>
                      <SelectLabel>Starter Recipes</SelectLabel>
                      {starterRecipes.map((recipe) => (
                        <SelectItem key={recipe.id} value={recipe.id}>
                          {recipe.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {ownRecipes.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>My Recipes</SelectLabel>
                        {ownRecipes.map((recipe) => (
                          <SelectItem key={recipe.id} value={recipe.id}>
                            {recipe.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <span id={ids.brandKit} className={LABEL}>
                  Brand Kit
                </span>
                <Select
                  value={setup.brandKitId ?? NONE}
                  onValueChange={(id) =>
                    dispatch({ type: 'brandKit', brandKitId: id === NONE ? null : id })
                  }
                >
                  <SelectTrigger aria-labelledby={ids.brandKit} data-testid="clip-setup-brand-kit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {kits.map((kit) => (
                      <SelectItem key={kit.id} value={kit.id}>
                        {kit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span id={ids.starters} className="sr-only">
                Starter Recipes
              </span>
              <ChoiceTiles<string>
                labelledBy={ids.starters}
                options={starterRecipes.map((recipe) => ({
                  value: recipe.id,
                  label: recipe.name,
                  line:
                    STARTER_RECIPES.find((starter) => starter.id === recipe.id)?.help ??
                    recipe.description,
                }))}
                value={setup.recipeId ?? ''}
                onValueChange={pickRecipe}
              />
              <p className={NOTE}>{RECIPE_HELP}</p>
              {canSaveRecipe ? (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSavingRecipe(true)}
                    data-testid="clip-setup-save-recipe"
                  >
                    <MotionIcon icon={BookmarkIcon} className="h-4 w-4" />
                    Save As Recipe
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={ids.request} className={LABEL}>
                What should we look for?
              </label>
              <Textarea
                id={ids.request}
                rows={2}
                maxLength={300}
                value={setup.request}
                placeholder={REQUEST_PLACEHOLDER}
                onChange={(event) => dispatch({ type: 'request', request: event.target.value })}
                data-testid="clip-setup-request"
              />
              <p className={NOTE}>
                For example:{' '}
                {REQUEST_EXAMPLES.map((example, index) => (
                  <span key={example}>
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 font-sans text-xs text-ink underline"
                      onClick={() => dispatch({ type: 'request', request: example })}
                    >
                      {example}
                    </button>
                    {index < REQUEST_EXAMPLES.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2">
                <span id={ids.length} className={LABEL}>
                  Clip Length
                </span>
                {dot('length')}
              </span>
              <Segmented<ClipLength>
                labelledBy={ids.length}
                options={LENGTH_OPTIONS}
                value={setup.length}
                onValueChange={(length) => dispatch({ type: 'length', length })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2">
                <span id={ids.shape} className={LABEL}>
                  Shape
                </span>
                {dot('ratio')}
              </span>
              <Segmented<Ratio>
                labelledBy={ids.shape}
                options={SETUP_RATIOS}
                value={setup.ratio}
                onValueChange={(ratio) => dispatch({ type: 'ratio', ratio })}
              />
            </div>
          </AnalyticsPanel>

          <AnalyticsPanel className="flex flex-col gap-4 p-4">
            <div className="flex items-center gap-3">
              <Toggle
                id={ids.captions}
                checked={setup.captions.on}
                onCheckedChange={(on) => dispatch({ type: 'captions', on })}
                data-testid="clip-setup-captions"
              />
              <span className="flex flex-1 items-center gap-2">
                <label htmlFor={ids.captions} className={LABEL}>
                  Captions
                </label>
                {dot('captions')}
              </span>
              {setup.captions.on ? (
                <Select
                  value={setup.captions.styleId}
                  onValueChange={(styleId) => dispatch({ type: 'captionStyle', styleId })}
                >
                  <SelectTrigger aria-label="Caption Style" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAPTION_STYLES.map((style) => (
                      <SelectItem key={style.id} value={style.id}>
                        {style.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <p className={NOTE}>
              Every clip opens with captions of what is said, in the style picked.
            </p>
          </AnalyticsPanel>

          {action.available ? (
            <AnalyticsPanel className="flex flex-col gap-4 p-4">
              <div className="flex items-center gap-3">
                <Toggle
                  id={ids.action}
                  checked={setup.action}
                  onCheckedChange={(on) => dispatch({ type: 'action', on })}
                  data-testid="clip-setup-action"
                />
                <label htmlFor={ids.action} className={`${LABEL} flex-1`}>
                  Look For Action
                </label>
                <span className="font-sans text-xs font-bold text-ink type-muted">
                  {actionPriceLabel(setup)}
                </span>
              </div>
              <p className={NOTE}>
                {ACTION_HELP}
                {action.vision ? ` ${ACTION_VISION_NOTE}` : ''}
              </p>
            </AnalyticsPanel>
          ) : null}

          {canFollow(setup.ratio) ? (
            <AnalyticsPanel
              className="flex flex-col gap-4 p-4"
              data-testid="clip-setup-follow-card"
            >
              <div className="flex items-center gap-3">
                <Toggle
                  id={ids.follow}
                  checked={setup.follow}
                  disabled={!faces}
                  onCheckedChange={(on) => dispatch({ type: 'follow', on })}
                  data-testid="clip-setup-follow"
                />
                <span className="flex flex-1 items-center gap-2">
                  <label htmlFor={ids.follow} className={LABEL}>
                    Follow The Speaker
                  </label>
                  {dot('follow')}
                </span>
                <span className="type-label text-xs text-ink type-muted">Free</span>
              </div>
              <p className={NOTE}>
                {FOLLOW_HELP}
                {faces ? '' : ` ${FOLLOW_OFF_NOTE}`}
              </p>
            </AnalyticsPanel>
          ) : null}

          <AnalyticsPanel className="flex flex-col gap-4 p-4" data-testid="clip-setup-cleanup-card">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Toggle
                  id={ids.silences}
                  checked={setup.silences}
                  onCheckedChange={(on) => dispatch({ type: 'silences', on })}
                  data-testid="clip-setup-silences"
                />
                <span className="flex flex-1 items-center gap-2">
                  <label htmlFor={ids.silences} className={LABEL}>
                    Remove Silences
                  </label>
                  {dot('silences')}
                </span>
                <span className="type-label text-xs text-ink type-muted">Free</span>
              </div>
              <p className={NOTE}>{SILENCES_HELP}</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Toggle
                  id={ids.hookTitle}
                  checked={setup.hookTitle}
                  onCheckedChange={(on) => dispatch({ type: 'hookTitle', on })}
                  data-testid="clip-setup-hook-title"
                />
                <span className="flex flex-1 items-center gap-2">
                  <label htmlFor={ids.hookTitle} className={LABEL}>
                    Hook Title
                  </label>
                  {dot('hookTitle')}
                </span>
                <span className="type-label text-xs text-ink type-muted">Free</span>
              </div>
              <p className={NOTE}>{HOOK_TITLE_HELP}</p>
            </div>
          </AnalyticsPanel>
        </div>

        <AnalyticsPanel
          aria-labelledby={ids.summary}
          className="sticky top-4 flex flex-col gap-4 p-4"
          data-testid="clip-setup-summary"
        >
          <PanelHeader id={ids.summary} title="Summary" />
          <SummaryBox
            title={summaryLines(setup, styleName, picked?.name ?? null)[0]}
            notes={summaryLines(setup, styleName, picked?.name ?? null).slice(1)}
            rowsLabel="Price in AI minutes"
            rows={
              price
                ? [
                    ...priceLines(price).map((line) => ({
                      id: line.step,
                      lead: line.name,
                      main: '',
                      end: line.value,
                    })),
                    {
                      id: 'total',
                      lead: <strong>Total</strong>,
                      main: '',
                      end: <strong data-testid="clip-setup-total">{price.total}</strong>,
                    },
                  ]
                : []
            }
          />
          <div className="flex items-center gap-1">
            <AiMinutesChip orgId={orgId} fallback={null} />
            <AiPrivacyHint lane={hostedLane} />
          </div>
          {shortfall ? (
            <Alert variant="warning" className="items-center" data-testid="clip-setup-shortfall">
              <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <p className="m-0 min-w-0 flex-1">{shortfall}</p>
              <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>
                See Plans
              </ActionLink>
            </Alert>
          ) : null}
          {problem ? (
            <Alert variant="danger" className="items-center" data-testid="clip-setup-problem">
              <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <p className="m-0 min-w-0 flex-1">{problem}</p>
            </Alert>
          ) : null}
          <Button
            variant="highlight"
            className="w-full"
            disabled={starting || pricing || !price || shortfall !== null}
            onClick={() => void start()}
            data-testid="clip-setup-find"
          >
            {starting ? <Spinner /> : <MotionIcon icon={SparklesIcon} className="h-4 w-4" />}
            {setupButtonLabel(price)}
          </Button>
          <p className={NOTE}>{HONEST_LINE}</p>
          <p className={NOTE}>{PAY_FOR_LOOKING}</p>
        </AnalyticsPanel>
      </div>
      <NameDialog
        open={savingRecipe}
        onOpenChange={setSavingRecipe}
        title="Save As Recipe"
        description="Saves these choices as a recipe for the whole workspace."
        label="Recipe name"
        placeholder={SETUP_RECIPE_PLACEHOLDER}
        initial=""
        maxLength={RECIPE_NAME_MAX}
        submitLabel="Save Recipe"
        busyLabel="Saving"
        onSubmit={saveRecipe}
        testId="clip-setup-save-recipe-dialog"
      />
    </div>
  );
}
