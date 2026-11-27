'use client';

/**
 * Apply A Recipe in the editor (Sprint 13, Module 10; blueprint section 8).
 *
 * 1. **Ask the server** (`POST /clips/:clipId/apply-recipe`): it checks the
 *    recipe is the workspace's, starts the free faces job when the recipe
 *    follows the speaker, quotes listening when the clip needs words, and
 *    hands back the recipe's brand kit in the engine's shape.
 * 2. **Gather what the engine reads**: the clip's spoken words (when they
 *    cover it), the caption styles, the saved layouts, the waveform's loud
 *    stretches, My Words, and for a hook title one line from the title
 *    writer (free, the first of its three).
 * 3. **One change**: `applyRecipe`, then the kit (`applyBrandKit`), and the
 *    recipe's id on the clip, run on the document as it is at that moment and
 *    committed as ONE undo step, said in a toast with Undo.
 * 4. **Then**: Follow The Speaker runs its usual flow (the faces job is the
 *    server's), a clip not listened to yet offers **Listen To This Clip**
 *    with its price and, once the words are in, applies the recipe's word
 *    parts as a second step; parts that are gone or skipped are said in
 *    toasts.
 */
import { ToastAction, toast } from '@postgear/ui';
import {
  type ClipDocument,
  loudFromPeaks,
  type RecipeSettings,
  type RecipeSkip,
  type RecipeView,
  applyRecipe,
} from '@postgear/video-engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  getClipWords,
  getWordList,
  listCaptionStyles,
  listenToVideo,
  listLayouts,
  suggestHookTitles,
} from '@/lib/clips-api';
import { applyRecipeToClip } from '@/lib/clips-recipes-api';
import type {
  CaptionStyleView,
  ClipWaveform,
  SavedLayoutView,
  TranscriptView,
} from '@/types/clips';
import type { ApplyRecipeAnswer } from '@/types/clips-recipes';
import { usePeaks } from '../timeline/timeline-media';
import { clipSpan, listenRange } from '../transcript/transcript-model';
import { mainSourceId } from '../transcript/transcript-pane';
import { useClipJob } from '../use-clip-job';
import {
  LISTEN_FOR_RECIPE,
  listenActionLabel,
  mergeMissing,
  missingSentence,
  needsWords,
  RECIPE_FAILED,
  recipeAppliedSentence,
  recipeChange,
  recipeContext,
  skippedLine,
  wordParts,
} from './recipe-model';

export interface EditorRecipesDeps {
  applyToClip: typeof applyRecipeToClip;
  words: (clipId: string) => Promise<TranscriptView | null>;
  styles: () => Promise<CaptionStyleView[]>;
  layouts: () => Promise<SavedLayoutView[]>;
  wordList: () => Promise<string[]>;
  hookTitles: (clipId: string) => Promise<string[]>;
  listen: typeof listenToVideo;
  /** Shows a toast; `action` is one button. */
  notify: (input: {
    title: string;
    variant?: 'warning';
    action?: { label: string; onClick: () => void };
  }) => void;
}

export const EDITOR_RECIPES_DEPS: EditorRecipesDeps = {
  applyToClip: applyRecipeToClip,
  words: async (clipId) => (await getClipWords(clipId, { source: 'spoken' })).transcript,
  styles: async () => (await listCaptionStyles()).styles,
  layouts: () => listLayouts(),
  wordList: () => getWordList(),
  hookTitles: (clipId) => suggestHookTitles(clipId),
  listen: listenToVideo,
  notify: ({ title, variant, action }) => {
    toast({
      title,
      ...(variant ? { variant } : {}),
      ...(action
        ? {
            action: (
              <ToastAction altText={action.label} onClick={action.onClick}>
                {action.label}
              </ToastAction>
            ),
          }
        : {}),
    });
  },
};

export interface EditorRecipes {
  /** A recipe is being applied (or its words fetched). */
  busy: boolean;
  /** Listening for a recipe's word parts, while it runs. */
  listening: boolean;
  /** Applies the recipe; null when it worked, else the sentence to show where it was asked. */
  apply: (recipe: RecipeView) => Promise<string | null>;
}

function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : RECIPE_FAILED;
}

export function useEditorRecipes({
  clipId,
  videoId,
  videoDurationMs,
  videoSize,
  waveform,
  styles: knownStyles,
  latestDocument,
  commit,
  onUndo,
  onFollow,
  deps = EDITOR_RECIPES_DEPS,
}: {
  clipId: string;
  videoId: string | null;
  videoDurationMs: number;
  videoSize: { width: number; height: number };
  waveform: ClipWaveform | null;
  /** The caption styles the editor already holds (used when the list cannot be read again). */
  styles: readonly CaptionStyleView[];
  /** The document as it is right now (not as it was at the last render). */
  latestDocument: () => ClipDocument;
  /** One undo step: applied only onto `start`. */
  commit: (start: ClipDocument, next: ClipDocument) => void;
  onUndo: () => void;
  /** Runs Follow The Speaker's own flow, after the recipe's change has landed. */
  onFollow: (mode: 'speaker' | 'both') => void;
  deps?: EditorRecipesDeps;
}): EditorRecipes {
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [follow, setFollow] = useState<{ mode: 'speaker' | 'both' } | null>(null);
  // The recipe whose word parts wait for listening.
  const waiting = useRef<RecipeView | null>(null);
  const peakData = usePeaks(waveform?.url ?? null);
  const isLoud = useMemo(
    () => (peakData && waveform ? loudFromPeaks(peakData, waveform.meta.perSecond) : undefined),
    [peakData, waveform],
  );
  const latest = useRef({ deps, isLoud, knownStyles, latestDocument, commit, onUndo, onFollow });
  latest.current = { deps, isLoud, knownStyles, latestDocument, commit, onUndo, onFollow };

  // Follow The Speaker after the recipe's change has rendered (its flow reads the new document).
  useEffect(() => {
    if (!follow) return;
    setFollow(null);
    latest.current.onFollow(follow.mode);
  }, [follow]);

  /** Everything the engine reads, fetched together; a list that does not load is left empty. */
  const gather = useCallback(
    async (settings: RecipeSettings, withWords: boolean) => {
      const { deps: d, knownStyles: held } = latest.current;
      const transcript = withWords ? await d.words(clipId).catch(() => null) : null;
      const heard = transcript !== null && transcript.words.length > 0;
      const [styles, layouts, workspaceWords, hookTitleText] = await Promise.all([
        d.styles().catch(() => [...held]),
        settings.layout?.presetId ? d.layouts().catch(() => []) : Promise.resolve([]),
        settings.bleep?.on && heard ? d.wordList().catch(() => []) : Promise.resolve([]),
        settings.hookTitle?.on && heard
          ? d
              .hookTitles(clipId)
              .then((titles) => titles[0] ?? null)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      return { transcript, styles, layouts, workspaceWords, hookTitleText };
    },
    [clipId],
  );

  const sayOutcome = useCallback(
    (
      missing: ApplyRecipeAnswer['missing'],
      skipped: readonly RecipeSkip[],
      styles: readonly CaptionStyleView[],
      listenLater: boolean,
    ) => {
      const { deps: d } = latest.current;
      for (const one of missing)
        d.notify({ title: missingSentence(one, styles), variant: 'warning' });
      // While listening is offered, the parts that wait for words are said by its toast.
      const line = skippedLine(
        listenLater ? skipped.filter((skip) => skip.reason !== 'no_transcript') : skipped,
      );
      if (line) d.notify({ title: line });
    },
    [],
  );

  /** The recipe's word parts, once the clip was listened to: the second step. */
  const applyWords = useCallback(
    async (recipe: RecipeView) => {
      const settings = wordParts(recipe.settings);
      const gathered = await gather(settings, true);
      const { latestDocument: read, commit: put, isLoud: loud, deps: d } = latest.current;
      const doc = read();
      const ctx = recipeContext({
        videoSize,
        ...gathered,
        ratio: doc.canvas.ratio,
        isLoud: loud,
      });
      const outcome = applyRecipe(doc, settings, ctx);
      if (outcome.doc !== doc) put(doc, outcome.doc);
      sayOutcome(outcome.missing, outcome.skipped, gathered.styles, false);
      if (outcome.doc !== doc) d.notify({ title: recipeAppliedSentence(recipe.name) });
    },
    [gather, sayOutcome, videoSize],
  );

  // Listening for a recipe: its words, then the word parts, when the job ends.
  const { job } = useClipJob(jobId);
  const jobStatus = job?.id === jobId ? job.status : null;
  const jobError = job?.error?.message ?? null;
  useEffect(() => {
    if (jobId === null || jobStatus === null) return;
    if (jobStatus === 'DONE') {
      setJobId(null);
      const recipe = waiting.current;
      waiting.current = null;
      if (recipe) void applyWords(recipe).catch(() => undefined);
    } else if (jobStatus === 'FAILED' || jobStatus === 'CANCELLED') {
      setJobId(null);
      waiting.current = null;
      if (jobStatus === 'FAILED') {
        latest.current.deps.notify({ title: jobError ?? RECIPE_FAILED, variant: 'warning' });
      }
    }
  }, [jobId, jobStatus, jobError, applyWords]);

  const listen = useCallback(
    async (recipe: RecipeView) => {
      const { deps: d, latestDocument: read } = latest.current;
      const doc = read();
      const span = clipSpan(doc, mainSourceId(doc));
      if (!videoId || !span) return;
      try {
        const outcome = await d.listen(videoId, listenRange(span, videoDurationMs));
        if (outcome.covered) {
          await applyWords(recipe);
        } else {
          waiting.current = recipe;
          setJobId(outcome.job.id);
        }
      } catch (cause) {
        d.notify({ title: sentenceOf(cause), variant: 'warning' });
      }
    },
    [videoId, videoDurationMs, applyWords],
  );

  const apply = useCallback(
    async (recipe: RecipeView): Promise<string | null> => {
      if (busy) return null;
      setBusy(true);
      try {
        const answer = await latest.current.deps.applyToClip(clipId, recipe.id);
        const settings = answer.recipe.settings;
        const listenLater = answer.needs.transcript === 'missing' && needsWords(settings);
        const gathered = await gather(settings, answer.needs.transcript === 'covered');
        // The change runs on the document as it is now: anything edited meanwhile is kept.
        const { latestDocument: read, commit: put, isLoud: loud, deps: d, onUndo } = latest.current;
        const doc = read();
        const ctx = recipeContext({
          videoSize,
          ...gathered,
          ratio: settings.ratio ?? doc.canvas.ratio,
          isLoud: loud,
        });
        const outcome = recipeChange(doc, settings, ctx, {
          recipeId: answer.recipe.id,
          brandKit: answer.brandKit,
        });
        put(doc, outcome.doc);
        d.notify({
          title: recipeAppliedSentence(answer.recipe.name),
          action: { label: 'Undo', onClick: onUndo },
        });
        sayOutcome(
          mergeMissing(answer.missing, outcome.missing),
          outcome.skipped,
          gathered.styles,
          listenLater,
        );
        if (outcome.follow) setFollow({ mode: outcome.follow.mode });
        if (listenLater) {
          d.notify({
            title: LISTEN_FOR_RECIPE,
            action: {
              label: listenActionLabel(answer.needs.listenPrice),
              onClick: () => void listen(answer.recipe),
            },
          });
        }
        return null;
      } catch (cause) {
        return sentenceOf(cause);
      } finally {
        setBusy(false);
      }
    },
    [busy, clipId, gather, listen, sayOutcome, videoSize],
  );

  return { busy, listening: jobId !== null, apply };
}
