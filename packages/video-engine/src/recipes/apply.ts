/**
 * Applying a recipe to a clip, and reading a clip back into one (Module 10).
 * Pure.
 *
 * `applyRecipe` runs each field the recipe has through the editor's own pure
 * edits, in a fixed order: shape, layout, follow, cleanup (silences and
 * filler words as one cut), captions, bleep, hook title. A field the recipe
 * leaves out is never touched. Nothing here throws for a missing part: a
 * deleted caption style or layout preset falls back and is listed in
 * `missing`, a part that cannot run yet (no words, no faces, no title line)
 * is listed in `needs` and `skipped`.
 *
 * The clip's **main source** is the source of its first part that is not a
 * brand kit's intro or outro. Intro and outro parts are never cut (their
 * stretches are taken out of every cut) and never captioned or bleeped (the
 * words are the main source's).
 *
 * `recipeFromClip` is the reverse: what the clip shows now, as settings, so
 * applying it to a fresh clip gives the same shape, layout, captions and
 * switches.
 */
import type { CaptionLook } from '../captions/styles';
import { builtInCaptionStyle, DEFAULT_CAPTION_POSITION } from '../captions/styles';
import { clipSourceRanges } from '../captions/map';
import {
  createCaptionsTrack,
  updateCaptionsTrack,
  withCaptionsTrack,
  withoutCaptions,
} from '../captions/track';
import {
  type BleepLists,
  bleepModeOf,
  clearBleeps,
  findBleepWords,
  setBleeps,
} from '../cleanup/bleeps';
import { mergeCuts, removeSourceRanges } from '../cleanup/cut-range';
import { findFillers } from '../cleanup/fillers';
import {
  findSilences,
  SILENCE_DEFAULT_MS,
  SILENCE_MAX_MS,
  SILENCE_MIN_MS,
} from '../cleanup/silences';
import type { ClipDocument, ClipLayout, SavedLayout, Segment } from '../document/schema';
import { copyTextStyle, HOOK_STYLE_IDS, type HookStyleId, textStylePreset } from '../document/text';
import { addHookTitle, hookTitleOf } from '../effects/hook';
import { canFollow } from '../highlights/follow';
import type { ClipLength } from '../highlights/fit';
import type { Genre } from '../highlights/genre';
import { applyLayout, applySavedLayout, setCanvasRatio, type VideoSize } from '../layout/edit';
import { isLayoutOffered, presetFor } from '../layout/presets';
import type { ExportQuality } from '../quality';
import { disableFollow, isFollowing } from '../reframe/follow';
import { removeItem } from '../time/items';
import { wordsInRanges } from '../transcript/window';
import type { MsRange, TranscriptWord } from '../transcript/types';
import {
  RECIPE_FALLBACK_CAPTION_STYLE,
  RECIPE_VERSION,
  type RecipeMissing,
  type RecipeNeed,
  type RecipeSettings,
  type RecipeSkip,
} from './schema';

/** The words of the clip's main source (the source of its first non-intro part). */
export interface RecipeTranscript {
  /** The `TRANSCRIPT` asset the captions track points at. */
  assetId: string;
  language: string;
  /** Video time; at least what the clip plays. */
  words: readonly TranscriptWord[];
  /** What was listened to (video time). */
  covered: readonly MsRange[];
}

export interface RecipeContext {
  /** The main source's picture size (layouts and shapes are fitted to it). */
  videoSize: VideoSize;
  /** Null when nothing the clip plays was listened to: word parts are skipped and `needs` says `transcript`. */
  transcript: RecipeTranscript | null;
  /** Built-in or the workspace's own caption look by id, null when it no longer exists. */
  captionLook(styleId: string): CaptionLook | null;
  /** A saved layout (`ClipLayoutPreset.layout`) by id, null when it no longer exists or is for another shape. */
  layoutPreset(presetId: string): SavedLayout | null;
  /** Remove Silences keeps loud gaps (the editor's waveform); left out, every gap counts. */
  isLoud?: (range: MsRange) => boolean;
  /** The hook title's line, when the caller has one (a title writer's answer, or the clip's AI title). */
  hookTitleText?: string | null;
  /** Bleep Bad Words' lists (the language's own plus My Words). */
  bleepLists?: BleepLists;
}

export interface RecipeOutcome {
  doc: ClipDocument;
  needs: RecipeNeed[];
  missing: RecipeMissing[];
  skipped: RecipeSkip[];
  /** Follow The Speaker to switch on after applying (the caller has the faces), or null. */
  follow: { mode: 'speaker' | 'both' } | null;
}

const NEED_ORDER: readonly RecipeNeed[] = ['transcript', 'faces', 'hookTitle'];

/** A brand kit's own part (played before or after the clip, from its own video). */
function isBrandPart(segment: Pick<Segment, 'role'>): boolean {
  return segment.role === 'intro' || segment.role === 'outro';
}

/** The source of the clip's first part that is not an intro or outro (the first part's when all are). */
function mainSourceOf(doc: Pick<ClipDocument, 'segments'>): string {
  const main = doc.segments.find((segment) => !isBrandPart(segment)) ?? doc.segments[0];
  return (main as Segment).source;
}

/** The stretches of the main source the clip plays, outside its intro and outro parts. */
function mainWindows(doc: ClipDocument, sourceId: string): MsRange[] {
  return clipSourceRanges(
    { segments: doc.segments.filter((segment) => !isBrandPart(segment)) },
    sourceId,
  );
}

/** `cuts` with every stretch an intro or outro part of the same source plays taken out. */
function sparingBrandParts(
  doc: ClipDocument,
  sourceId: string,
  cuts: readonly MsRange[],
): MsRange[] {
  const kept = doc.segments
    .filter((segment) => isBrandPart(segment) && segment.source === sourceId)
    .map((segment) => ({ fromMs: segment.sourceIn, toMs: segment.sourceOut }));
  if (kept.length === 0) return [...cuts];
  const out: MsRange[] = [];
  for (const cut of cuts) {
    let pieces: MsRange[] = [cut];
    for (const keep of kept) {
      pieces = pieces.flatMap((piece) => {
        if (keep.toMs <= piece.fromMs || keep.fromMs >= piece.toMs) return [piece];
        const left = { fromMs: piece.fromMs, toMs: keep.fromMs };
        const right = { fromMs: keep.toMs, toMs: piece.toMs };
        return [left, right].filter((range) => range.toMs > range.fromMs);
      });
    }
    out.push(...pieces);
  }
  return out;
}

type CutOutcome =
  | { ok: true; doc: ClipDocument }
  | { ok: false; reason: 'clip_too_short' | 'nothing_found' };

/**
 * One cut of `cuts`. Past `MAX_SEGMENTS` the longest cuts that still fit are
 * kept (the most time saved for the parts allowed); under the clip's
 * shortest length the cut is not made.
 */
function cutOnce(doc: ClipDocument, sourceId: string, cuts: readonly MsRange[]): CutOutcome {
  const all = mergeCuts(cuts);
  const first = removeSourceRanges(doc, sourceId, all);
  if (first.ok) return { ok: true, doc: first.doc };
  if (first.code === 'nothing_to_cut') return { ok: false, reason: 'nothing_found' };
  if (first.code !== 'too_many_segments') return { ok: false, reason: 'clip_too_short' };

  const longest = [...all].sort(
    (a, b) => b.toMs - b.fromMs - (a.toMs - a.fromMs) || a.fromMs - b.fromMs,
  );
  let low = 0;
  let high = longest.length - 1;
  let best: ClipDocument | null = null;
  while (low <= high) {
    const count = Math.floor((low + high + 1) / 2);
    if (count === 0) break;
    const result = removeSourceRanges(doc, sourceId, longest.slice(0, count));
    if (result.ok) {
      best = result.doc;
      low = count + 1;
    } else if (result.code === 'too_many_segments') {
      high = count - 1;
    } else {
      // Fewer cuts never make a clip shorter; anything else stops the search.
      high = count - 1;
    }
  }
  return best ? { ok: true, doc: best } : { ok: false, reason: 'nothing_found' };
}

function withCleanupMeta(
  doc: ClipDocument,
  cleanup: { silencesMinMs?: number; fillers?: true },
): ClipDocument {
  const meta = doc.meta ?? {};
  return { ...doc, meta: { ...meta, cleanup: { ...(meta.cleanup ?? {}), ...cleanup } } };
}

/** The built-in look of the fallback caption style. */
function fallbackLook(ctx: RecipeContext): CaptionLook {
  return (
    ctx.captionLook(RECIPE_FALLBACK_CAPTION_STYLE) ??
    (builtInCaptionStyle(RECIPE_FALLBACK_CAPTION_STYLE) as { look: CaptionLook }).look
  );
}

type LayoutStep =
  | { kind: 'none' }
  | { kind: 'skip' }
  | { kind: 'preset'; layout: Exclude<ClipLayout['kind'], 'custom'> }
  | { kind: 'saved'; layout: SavedLayout };

/** What the recipe's layout does on this shape, and what it reports. */
function layoutStep(
  doc: ClipDocument,
  layout: NonNullable<RecipeSettings['layout']>,
  ctx: RecipeContext,
  missing: RecipeMissing[],
): LayoutStep {
  const ratio = doc.canvas.ratio;
  const offeredPreset =
    layout.kind !== 'custom' && presetFor(layout.kind, ratio) !== null
      ? (layout.kind as Exclude<ClipLayout['kind'], 'custom'>)
      : null;
  if (layout.presetId !== undefined) {
    const saved = ctx.layoutPreset(layout.presetId);
    if (saved) return { kind: 'saved', layout: saved };
    if (offeredPreset) {
      missing.push({ part: 'layoutPreset', id: layout.presetId, usedInstead: offeredPreset });
      return { kind: 'preset', layout: offeredPreset };
    }
    if (layout.custom) {
      missing.push({ part: 'layoutPreset', id: layout.presetId, usedInstead: 'custom' });
      return { kind: 'saved', layout: layout.custom };
    }
    missing.push({ part: 'layoutPreset', id: layout.presetId, usedInstead: null });
    return { kind: 'none' };
  }
  if (layout.kind === 'custom') {
    return layout.custom ? { kind: 'saved', layout: layout.custom } : { kind: 'none' };
  }
  if (!isLayoutOffered(layout.kind, ratio) || !offeredPreset) return { kind: 'skip' };
  return { kind: 'preset', layout: offeredPreset };
}

/**
 * Applies each present field through the existing pure edits, in a fixed
 * order: shape, layout, follow, cleanup (silences and fillers as one cut),
 * captions, bleep, hook title. Never fails because of a missing part.
 * `recipeId` is left to the caller, which knows the recipe's id.
 */
export function applyRecipe(
  input: ClipDocument,
  settings: RecipeSettings,
  ctx: RecipeContext,
): RecipeOutcome {
  let doc = input;
  const needs = new Set<RecipeNeed>();
  const missing: RecipeMissing[] = [];
  const skipped: RecipeSkip[] = [];
  let follow: RecipeOutcome['follow'] = null;

  const followedBefore = doc.layout.follow?.mode ?? null;
  // A shape or layout change frames other areas: following stops, and comes back after (below).
  let followStopped = false;
  const stopFollowing = () => {
    if (isFollowing(doc)) {
      doc = disableFollow(doc);
      followStopped = true;
    }
  };

  // 1. Shape.
  if (settings.ratio !== undefined && settings.ratio !== doc.canvas.ratio) {
    stopFollowing();
    doc = setCanvasRatio(doc, settings.ratio, ctx.videoSize);
  }

  // 2. Layout.
  if (settings.layout) {
    const step = layoutStep(doc, settings.layout, ctx, missing);
    if (step.kind === 'skip') {
      skipped.push({ part: 'layout', reason: 'not_offered' });
    } else if (step.kind === 'preset') {
      stopFollowing();
      doc = applyLayout(doc, step.layout, ctx.videoSize);
    } else if (step.kind === 'saved') {
      stopFollowing();
      doc = applySavedLayout(doc, step.layout, ctx.videoSize);
    }
  }

  // 3. Follow The Speaker (the caller has the faces and switches it on).
  const followSettings = settings.follow;
  if (followSettings?.on) {
    if (!canFollow(doc.canvas.ratio)) {
      skipped.push({ part: 'follow', reason: 'not_offered' });
    } else if (doc.layout.follow?.mode !== followSettings.mode) {
      follow = { mode: followSettings.mode };
      needs.add('faces');
    }
  } else if (followSettings && !followSettings.on) {
    doc = disableFollow(doc);
  } else if (followStopped && followedBefore && canFollow(doc.canvas.ratio)) {
    follow = { mode: followedBefore };
    needs.add('faces');
  }

  // 4 to 6 need the words of the main source.
  const sourceId = mainSourceOf(doc);
  const transcript = ctx.transcript;
  const wantsWords =
    settings.silences?.on === true ||
    settings.fillers?.on === true ||
    settings.captions?.on === true ||
    settings.bleep?.on === true;
  let speech: 'none' | 'silent' | 'ok' = 'ok';
  if (wantsWords) {
    if (!transcript) {
      speech = 'none';
      needs.add('transcript');
    } else if (
      wordsInRanges({ words: [...transcript.words] }, mainWindows(doc, sourceId)).length === 0
    ) {
      speech = 'silent';
    }
  }
  const wordSkip = (part: RecipeSkip['part']): boolean => {
    if (speech === 'ok') return false;
    skipped.push({ part, reason: speech === 'none' ? 'no_transcript' : 'no_speech' });
    return true;
  };

  // 4. Cleanup: silences and filler words as one cut.
  const silencesOn = settings.silences?.on === true && !wordSkip('silences');
  const fillersOn = settings.fillers?.on === true && !wordSkip('fillers');
  if ((silencesOn || fillersOn) && transcript) {
    const windows = mainWindows(doc, sourceId);
    const silenceCuts = silencesOn
      ? findSilences({ words: [...transcript.words], covered: [...transcript.covered] }, windows, {
          minMs: settings.silences?.minMs,
          isLoud: ctx.isLoud,
        }).cuts
      : [];
    const fillerCuts = fillersOn
      ? findFillers({ words: [...transcript.words] }, transcript.language, windows).flatMap(
          (group) => group.cuts,
        )
      : [];
    const cuts = sparingBrandParts(doc, sourceId, [...silenceCuts, ...fillerCuts]);
    if (silencesOn && silenceCuts.length === 0)
      skipped.push({ part: 'silences', reason: 'nothing_found' });
    if (fillersOn && fillerCuts.length === 0)
      skipped.push({ part: 'fillers', reason: 'nothing_found' });
    if (cuts.length > 0) {
      const cut = cutOnce(doc, sourceId, cuts);
      if (cut.ok) {
        doc = cut.doc;
      } else {
        if (silencesOn && silenceCuts.length > 0)
          skipped.push({ part: 'silences', reason: cut.reason });
        if (fillersOn && fillerCuts.length > 0)
          skipped.push({ part: 'fillers', reason: cut.reason });
      }
    }
    const silencesMinMs = settings.silences?.minMs ?? SILENCE_DEFAULT_MS;
    const recorded = {
      ...(silencesOn && !skipped.some((s) => s.part === 'silences' && s.reason === 'clip_too_short')
        ? { silencesMinMs }
        : {}),
      ...(fillersOn && !skipped.some((s) => s.part === 'fillers' && s.reason === 'clip_too_short')
        ? { fillers: true as const }
        : {}),
    };
    if (Object.keys(recorded).length > 0) doc = withCleanupMeta(doc, recorded);
  }

  // 5. Captions.
  const captions = settings.captions;
  if (captions && !captions.on) {
    doc = withoutCaptions(doc);
  } else if (captions?.on && !wordSkip('captions') && transcript) {
    let styleId = captions.styleId;
    let look = ctx.captionLook(styleId);
    if (!look) {
      missing.push({
        part: 'captionStyle',
        id: styleId,
        usedInstead: RECIPE_FALLBACK_CAPTION_STYLE,
      });
      styleId = RECIPE_FALLBACK_CAPTION_STYLE;
      look = fallbackLook(ctx);
    }
    const track = createCaptionsTrack({
      transcriptAssetId: transcript.assetId,
      language: transcript.language,
      styleId,
      look,
    });
    const chosen = look;
    doc = updateCaptionsTrack(withCaptionsTrack(doc, track), (current) => ({
      ...current,
      styleId,
      position: { ...(captions.position ?? DEFAULT_CAPTION_POSITION) },
      sizePx: captions.sizePx ?? chosen.sizePx,
      maxWords: captions.maxWords ?? chosen.maxWords,
    }));
  }

  // 6. Bleep Bad Words.
  const bleep = settings.bleep;
  if (bleep && !bleep.on) {
    doc = clearBleeps(doc);
  } else if (bleep?.on && !wordSkip('bleep') && transcript) {
    const words = wordsInRanges({ words: [...transcript.words] }, mainWindows(doc, sourceId)).map(
      (word) => ({ index: word.i, text: word.text, start: word.start, end: word.end }),
    );
    const found = findBleepWords(
      words,
      ctx.bleepLists ?? { language: transcript.language, workspace: [] },
    );
    if (found.length === 0) skipped.push({ part: 'bleep', reason: 'nothing_found' });
    else doc = setBleeps(doc, found, bleep.mode, sourceId);
  }

  // 7. Hook title.
  const hook = settings.hookTitle;
  if (hook && !hook.on) {
    const existing = hookTitleOf(doc);
    if (existing) {
      const removed = removeItem(doc, existing.id);
      if (removed.ok) doc = removed.doc;
    }
  } else if (hook?.on) {
    const text = ctx.hookTitleText?.trim() || hookTitleOf(doc)?.text || '';
    if (text.length > 0) doc = addHookTitle(doc, text, hook.look);
    else needs.add('hookTitle');
  }

  return {
    doc,
    needs: NEED_ORDER.filter((need) => needs.has(need)),
    missing,
    skipped,
    follow,
  };
}

/** The hook look a hook title is drawn in: the look whose style it has, else the first. */
function hookLookOf(style: unknown): HookStyleId {
  const wanted = JSON.stringify(style);
  const match = HOOK_STYLE_IDS.find(
    (id) => JSON.stringify(copyTextStyle(textStylePreset(id).style)) === wanted,
  );
  return match ?? HOOK_STYLE_IDS[0];
}

const STYLE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/** A layout as saved, without `follow`. */
function ownLayout(layout: ClipLayout): SavedLayout {
  if (layout.follow) return layout.follow.saved;
  const { follow: _follow, ...rest } = layout;
  return rest;
}

/** What the clip looks like now, as settings (what the user sees is what is saved). */
export function recipeFromClip(
  doc: ClipDocument,
  extras: { exportQuality?: ExportQuality; clipLength?: ClipLength; genre?: Genre } = {},
): RecipeSettings {
  const settings: RecipeSettings = { version: RECIPE_VERSION, ratio: doc.canvas.ratio };

  const own = ownLayout(doc.layout);
  settings.layout =
    own.kind === 'custom'
      ? { kind: 'custom', custom: JSON.parse(JSON.stringify(own)) as SavedLayout }
      : { kind: own.kind };
  if (doc.layout.follow) settings.follow = { on: true, mode: doc.layout.follow.mode };

  const track = doc.tracks.find((candidate) => candidate.kind === 'captions');
  if (track && track.kind === 'captions') {
    settings.captions = {
      on: true,
      styleId: STYLE_ID.test(track.styleId) ? track.styleId : RECIPE_FALLBACK_CAPTION_STYLE,
      position: { x: track.position.x, y: track.position.y },
      sizePx: track.sizePx,
      maxWords: track.maxWords,
    };
  }

  const cleanup = doc.meta?.cleanup;
  if (cleanup?.silencesMinMs !== undefined) {
    settings.silences = {
      on: true,
      minMs: Math.min(SILENCE_MAX_MS, Math.max(SILENCE_MIN_MS, Math.round(cleanup.silencesMinMs))),
    };
  }
  if (cleanup?.fillers) settings.fillers = { on: true };

  const mode = bleepModeOf(doc);
  if (mode) settings.bleep = { on: true, mode };

  const title = hookTitleOf(doc);
  if (title) settings.hookTitle = { on: true, look: hookLookOf(title.style) };

  if (extras.clipLength !== undefined) settings.clipLength = extras.clipLength;
  if (extras.genre !== undefined) settings.genre = extras.genre;
  if (extras.exportQuality !== undefined) settings.exportQuality = extras.exportQuality;
  return settings;
}

export type { HookStyleId };
