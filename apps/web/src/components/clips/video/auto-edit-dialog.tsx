'use client';

/**
 * Auto-Edit Video (Sprint 13, Module 10, CA-6.4; blueprint section 8): one
 * press makes one clip over the whole video with a recipe applied, for
 * people who want their recording cleaned, not cut into highlights.
 *
 * A small dialog, not Clip Setup: the recipe (`Select`, Auto-Edit Talking
 * Video first), its line, the stretch (the whole video up to 30 minutes;
 * past that, two handles and the sentence that says why), the price in AI
 * minutes (asked for again as the choices change, never a charge), and the
 * AI minutes chip. Too few minutes turns the button off with the missing
 * number and See Plans.
 *
 * Pressed: made at once (200, nothing to listen to) opens the editor
 * straight away. Otherwise the job's steps show in words with a `Progress`
 * in the ai tone ("Listening to what is said", "Applying your recipe"), and
 * when it is done the editor opens by itself while this page is still open,
 * with **Open The Clip** for good measure. A part the recipe could not run
 * is said in a toast and in a muted line; a video with nobody speaking
 * says so.
 *
 * The dialog stays mounted while closed, so a run started here still opens
 * its clip when it is done.
 */
import { WandSparklesIcon } from '@animateicons/react/lucide/wand-sparkles-icon';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MotionIcon,
  Progress,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
} from '@postgear/ui';
import {
  DEFAULT_AUTO_EDIT_RECIPE,
  type RecipeSkip,
  type RecipeView,
  STARTER_RECIPES,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { ApiError } from '@/lib/api';
import { cancelClipJob } from '@/lib/clips-api';
import { autoEditPrice, listRecipes, startAutoEdit } from '@/lib/clips-recipes-api';
import type { AutoEditPriceView } from '@/types/clips-recipes';
import { recipeLine } from '../editor/recipe-dialogs';
import { skippedLine } from '../editor/recipe-model';
import { AiMinutesChip } from '../home/clips-meters';
import { RefusalAlert } from '../home/refusal-alert';
import { RangeControl } from '../setup/range-control';
import { shortfallSentence } from '../setup/setup-model';
import { useClipJob } from '../use-clip-job';
import { WaitingNote } from '../waiting-note';
import {
  AUTO_EDIT_DONE,
  AUTO_EDIT_HELP,
  AUTO_EDIT_LABEL,
  AUTO_EDIT_RUNNING,
  AUTO_EDIT_TOO_LONG,
  autoEditButtonLabel,
  autoEditOutputOf,
  autoEditStepLabel,
  initialAutoEditRange,
  NO_MINUTES_NEEDED,
  NO_SPEECH_NOTE,
  needsAutoEditRange,
  rangeTooLong,
} from './auto-edit-model';
import { clipEditHref } from './video-clip-list';

const NOTE = 'm-0 font-sans text-xs text-ink type-muted';
const LABEL = 'font-sans text-sm font-bold text-ink';
const FAILED = 'That did not work. Check your connection and try again.';
/** The price is asked for again this long after the last change. */
const PRICE_DELAY_MS = 300;

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

export interface AutoEditDeps {
  list: typeof listRecipes;
  price: typeof autoEditPrice;
  start: typeof startAutoEdit;
  cancel: typeof cancelClipJob;
}

const DEFAULT_DEPS: AutoEditDeps = {
  list: listRecipes,
  price: autoEditPrice,
  start: startAutoEdit,
  cancel: cancelClipJob,
};

interface Finished {
  clipId: string;
  skipped: RecipeSkip[];
  noSpeech: boolean;
}

export function AutoEditDialog({
  orgId,
  video,
  open,
  onOpenChange,
  deps = DEFAULT_DEPS,
}: {
  orgId: string;
  video: { id: string; title: string; durationMs: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deps?: AutoEditDeps;
}) {
  const router = useRouter();
  const recipeLabel = useId();
  const rangeLabel = useId();
  const [recipes, setRecipes] = useState<RecipeView[]>(STARTER_VIEWS);
  const [recipeId, setRecipeId] = useState<string>(DEFAULT_AUTO_EDIT_RECIPE);
  const [range, setRange] = useState(() => initialAutoEditRange(video.durationMs));
  const [price, setPrice] = useState<AutoEditPriceView | null>(null);
  const [pricing, setPricing] = useState(false);
  // `run`: what a finished run said (a failed listen); a new price keeps it, the next run clears it.
  const [problem, setProblem] = useState<{
    text: string;
    code: string | undefined;
    run?: true;
  } | null>(null);
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<{ jobId: string; clipId: string } | null>(null);
  const [done, setDone] = useState<Finished | null>(null);
  const long = needsAutoEditRange(video.durationMs) || price?.needsRange === true;
  const tooLong = long && rangeTooLong(range);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // The recipes, once the dialog first opens (the starters until they arrive).
  const loaded = useRef(false);
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    deps
      .list()
      .then((view) => {
        if (live.current && view.recipes.length > 0) setRecipes(view.recipes);
      })
      .catch(() => undefined);
  }, [open, deps]);

  // The price, again after every change while the dialog is open (never a charge).
  useEffect(() => {
    if (!open || run || done) return;
    const abort = new AbortController();
    setPricing(true);
    const timer = setTimeout(() => {
      deps
        .price(video.id, { recipeId, ...(long ? { range } : {}) })
        .then((view) => {
          if (abort.signal.aborted) return;
          setPrice(view);
          setPricing(false);
          setProblem((current) => (current?.run ? current : null));
        })
        .catch((cause) => {
          if (abort.signal.aborted) return;
          setPricing(false);
          setPrice(null);
          setProblem({
            text: cause instanceof ApiError && cause.status !== 0 ? cause.message : FAILED,
            code: cause instanceof ApiError ? cause.code : undefined,
          });
        });
    }, PRICE_DELAY_MS);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [open, run, done, deps, video.id, recipeId, long, range]);

  const openClip = useCallback(
    (clipId: string) => router.push(clipEditHref(orgId, clipId)),
    [orgId, router],
  );

  const sayFinished = useCallback((finished: Finished) => {
    const line = skippedLine(finished.skipped);
    if (finished.noSpeech) toast({ title: NO_SPEECH_NOTE });
    else if (line) toast({ title: line });
  }, []);

  // The job, live: its steps in words; done opens the clip while this page is open.
  const { job } = useClipJob(run?.jobId ?? null);
  const status = job && run && job.id === run.jobId ? job.status : null;
  useEffect(() => {
    if (!run || !job || job.id !== run.jobId) return;
    if (status === 'DONE') {
      const finished = autoEditOutputOf(job, run.clipId);
      setRun(null);
      setDone(finished);
      sayFinished(finished);
      openClip(finished.clipId);
    } else if (status === 'FAILED') {
      setRun(null);
      setProblem({ text: job.error?.message ?? FAILED, code: job.error?.code, run: true });
    } else if (status === 'CANCELLED') {
      setRun(null);
    }
  }, [run, job, status, openClip, sayFinished]);

  const shortfall = price
    ? shortfallSentence({
        total: price.aiMinutes,
        remaining: price.remaining,
        cycleEnd: price.cycleEnd,
      })
    : null;
  const recipe = recipes.find((one) => one.id === recipeId) ?? null;
  const starters = recipes.filter((one) => one.builtIn);
  const own = recipes.filter((one) => !one.builtIn);
  const running = run !== null;

  const start = async () => {
    if (starting || running || tooLong || shortfall || !price) return;
    setStarting(true);
    setProblem(null);
    try {
      const started = await deps.start(video.id, { recipeId, ...(long ? { range } : {}) });
      if (!live.current) return;
      if (started.job) {
        setRun({ jobId: started.job.id, clipId: started.clipId });
        return;
      }
      const finished = {
        clipId: started.clipId,
        skipped: started.skipped,
        noSpeech: started.noSpeech,
      };
      setDone(finished);
      sayFinished(finished);
      openClip(started.clipId);
    } catch (cause) {
      if (!live.current) return;
      const code = cause instanceof ApiError ? cause.code : undefined;
      setProblem({
        text:
          code === 'auto_edit_running'
            ? AUTO_EDIT_RUNNING
            : cause instanceof ApiError && cause.status !== 0
              ? cause.message
              : FAILED,
        code,
      });
    } finally {
      if (live.current) setStarting(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    try {
      await deps.cancel(run.jobId);
    } catch (cause) {
      setProblem({
        text: cause instanceof ApiError && cause.status !== 0 ? cause.message : FAILED,
        code: undefined,
      });
    }
  };

  const doneLine = done ? (done.noSpeech ? NO_SPEECH_NOTE : skippedLine(done.skipped)) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="clip-auto-edit">
        <DialogHeader>
          <DialogTitle>{AUTO_EDIT_LABEL}</DialogTitle>
          <DialogDescription>{AUTO_EDIT_HELP}</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col gap-2" data-testid="clip-auto-edit-done">
            <p className="m-0 font-sans text-sm font-bold text-ink" role="status">
              {AUTO_EDIT_DONE}
            </p>
            {doneLine ? (
              <p className={NOTE} data-testid="clip-auto-edit-note">
                {doneLine}
              </p>
            ) : null}
          </div>
        ) : running ? (
          <div className="flex flex-col gap-2" data-testid="clip-auto-edit-progress">
            <Progress tone="ai" value={job?.progress ?? 0} aria-label={autoEditStepLabel(job)} />
            <p className="m-0 font-sans text-sm text-ink" role="status">
              {autoEditStepLabel(job)}
            </p>
            <WaitingNote job={job} className="m-0 font-sans text-sm text-ink type-muted" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span id={recipeLabel} className={LABEL}>
                Recipe
              </span>
              <Select value={recipeId} onValueChange={setRecipeId} disabled={starting}>
                <SelectTrigger aria-labelledby={recipeLabel} data-testid="clip-auto-edit-recipe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Starter Recipes</SelectLabel>
                    {starters.map((one) => (
                      <SelectItem key={one.id} value={one.id}>
                        {one.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {own.length > 0 ? (
                    <SelectGroup>
                      <SelectLabel>My Recipes</SelectLabel>
                      {own.map((one) => (
                        <SelectItem key={one.id} value={one.id}>
                          {one.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                </SelectContent>
              </Select>
              {recipe ? (
                <p className={NOTE} data-testid="clip-auto-edit-line">
                  {recipeLine(recipe)}
                </p>
              ) : null}
            </div>

            {long ? (
              <div className="flex flex-col gap-2" data-testid="clip-auto-edit-range">
                <span id={rangeLabel} className={LABEL}>
                  Range
                </span>
                <RangeControl
                  fromMs={range.fromMs}
                  toMs={range.toMs}
                  durationMs={video.durationMs}
                  onChange={(fromMs, toMs) => setRange({ fromMs, toMs })}
                />
                <p className={NOTE}>{AUTO_EDIT_TOO_LONG}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {price && price.aiMinutes === 0 ? (
                <span className={NOTE} data-testid="clip-auto-edit-free">
                  {NO_MINUTES_NEEDED}
                </span>
              ) : null}
              <AiMinutesChip orgId={orgId} fallback={null} />
            </div>

            {tooLong ? (
              <Alert variant="warning" className="items-center" data-testid="clip-auto-edit-long">
                <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                <p className="m-0 min-w-0 flex-1">{AUTO_EDIT_TOO_LONG}</p>
              </Alert>
            ) : null}
            {shortfall ? (
              <Alert
                variant="warning"
                className="items-center"
                data-testid="clip-auto-edit-shortfall"
              >
                <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                <p className="m-0 min-w-0 flex-1">{shortfall}</p>
                <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>
                  See Plans
                </ActionLink>
              </Alert>
            ) : null}
          </div>
        )}

        {problem ? (
          <RefusalAlert message={problem.text} code={problem.code} orgId={orgId} className="mt-2" />
        ) : null}

        <DialogFooter>
          {done ? (
            <Button onClick={() => openClip(done.clipId)} data-testid="clip-auto-edit-open">
              Open The Clip
            </Button>
          ) : running ? (
            <Button variant="secondary" onClick={() => void cancel()}>
              Cancel
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={starting}>
                Cancel
              </Button>
              <Button
                variant="highlight"
                disabled={starting || pricing || !price || tooLong || shortfall !== null}
                onClick={() => void start()}
                data-testid="clip-auto-edit-start"
              >
                {starting ? (
                  <Spinner />
                ) : (
                  <MotionIcon icon={WandSparklesIcon} className="h-4 w-4" />
                )}
                {autoEditButtonLabel(price?.aiMinutes ?? null)}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
