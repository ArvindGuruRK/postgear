/**
 * Recipes in the editor (Sprint 13, Module 10), apart from React: the words
 * of Save As Recipe and Apply A Recipe, the context the engine's
 * `applyRecipe` reads, and the one change that applies a recipe (and its
 * brand kit) to a clip.
 *
 * The engine does the edits (`applyRecipe`, `applyBrandKit`); this file
 * only gathers what they read and says what happened in sentences. The
 * Auto-Edit dialog on the video page uses the same sentences for the parts
 * a recipe could not run.
 */
import {
  applyBrandKit,
  applyRecipe,
  type BrandParts,
  builtInCaptionStyle,
  type CaptionLook,
  type ClipBrandKit,
  type ClipDocument,
  type MsRange,
  PRESET_LABELS,
  type PresetKind,
  RATIO_LABELS,
  type Ratio,
  RECIPE_FALLBACK_CAPTION_STYLE,
  type RecipeContext,
  type RecipeMissing,
  type RecipeOutcome,
  type RecipeSettings,
  type RecipeSkip,
} from '@postgear/video-engine';
import type { CaptionStyleView, SavedLayoutView, TranscriptView } from '@/types/clips';
import { minutesLabel } from '../setup/setup-model';
import { spokenLength } from '../transcript/transcript-model';

export const SAVE_AS_RECIPE = 'Save As Recipe';
export const APPLY_A_RECIPE = 'Apply A Recipe';
export const RECIPE_NAME_LABEL = 'Recipe name';
export const RECIPE_NAME_PLACEHOLDER = 'Enter your recipe name';
export const SAVE_RECIPE_HELP =
  'Saves how this clip is set up, so any clip can be made the same way.';
export const APPLY_RECIPE_HELP = 'Sets this clip up the way the recipe says. Undo takes it back.';
export const NO_OWN_RECIPES = 'No recipes of your own yet. Save one from a clip you like.';
export const RECIPES_LOAD_FAILED = 'The recipes could not be loaded. Check your connection.';
export const RECIPE_FAILED = 'That did not work. Check your connection and try again.';
export const KEEP_BRAND_KIT = 'Keep the brand kit';
export const NOTHING_TO_SAVE = 'Nothing on this clip makes a recipe yet.';
export const LISTEN_FOR_RECIPE = 'Listen to this clip to remove silences and add captions.';
export const LISTENING_FOR_RECIPE = 'Listening to what is said';

export function recipeSavedSentence(name: string): string {
  return `${name} saved as a recipe.`;
}

export function recipeAppliedSentence(name: string): string {
  return `${name} applied.`;
}

/** "Listen To This Clip (12 AI Minutes)": the toast's action after a recipe that needs words. */
export function listenActionLabel(minutes: number): string {
  return minutes > 0 ? `Listen To This Clip (${minutesLabel(minutes)})` : 'Listen To This Clip';
}

// ---------------------------------------------------------------------------
// Reading a recipe back
// ---------------------------------------------------------------------------

/** A caption style's name: the workspace's own first, then the built-in ones. */
export function captionStyleName(
  styleId: string,
  styles: readonly Pick<CaptionStyleView, 'id' | 'name'>[] = [],
): string | null {
  return (
    styles.find((style) => style.id === styleId)?.name ?? builtInCaptionStyle(styleId)?.name ?? null
  );
}

function layoutName(kind: string): string {
  return kind === 'custom' ? 'Custom' : (PRESET_LABELS[kind as PresetKind] ?? kind);
}

/**
 * What a recipe holds, one line a part, for the read-back in Save As Recipe
 * (sentence case: they are a list of what will be saved, not names).
 */
export function recipePartLines(
  settings: RecipeSettings,
  styles: readonly Pick<CaptionStyleView, 'id' | 'name'>[] = [],
): string[] {
  const lines: string[] = [];
  if (settings.ratio) lines.push(`Shape: ${RATIO_LABELS[settings.ratio as Ratio]}`);
  if (settings.layout) {
    lines.push(
      settings.layout.presetId
        ? `Layout: your saved ${layoutName(settings.layout.kind)} layout`
        : `Layout: ${layoutName(settings.layout.kind)}`,
    );
  }
  if (settings.follow) {
    lines.push(
      !settings.follow.on
        ? 'No following'
        : settings.follow.mode === 'both'
          ? 'Follow the speaker, both people shown'
          : 'Follow the speaker',
    );
  }
  if (settings.captions) {
    lines.push(
      settings.captions.on
        ? `Captions: ${captionStyleName(settings.captions.styleId, styles) ?? settings.captions.styleId}`
        : 'No captions',
    );
  }
  if (settings.silences?.on) {
    lines.push(`Remove silences of ${spokenLength(settings.silences.minMs)} or more`);
  }
  if (settings.fillers?.on) lines.push('Remove filler words');
  if (settings.bleep?.on) {
    lines.push(settings.bleep.mode === 'mute' ? 'Mute bad words' : 'Bleep bad words');
  }
  if (settings.hookTitle?.on) lines.push('Hook title');
  if (settings.exportQuality) lines.push(`Export at ${settings.exportQuality}`);
  return lines;
}

/** One sentence for a part the recipe names that is gone. */
export function missingSentence(
  missing: RecipeMissing,
  styles: readonly Pick<CaptionStyleView, 'id' | 'name'>[] = [],
): string {
  switch (missing.part) {
    case 'captionStyle': {
      const used = captionStyleName(missing.usedInstead ?? RECIPE_FALLBACK_CAPTION_STYLE, styles);
      return `This recipe's caption style was deleted. We used ${used ?? 'Clean'} instead.`;
    }
    case 'layoutPreset':
      return missing.usedInstead
        ? `This recipe's saved layout was deleted. We used ${layoutName(missing.usedInstead)} instead.`
        : "This recipe's saved layout was deleted. We kept the clip's own layout.";
    case 'brandKit':
      return "This recipe's brand kit was deleted, so it was left out.";
  }
}

const PART_NAMES: Readonly<Record<RecipeSkip['part'], string>> = Object.freeze({
  layout: 'The layout',
  follow: 'Follow The Speaker',
  captions: 'Captions',
  silences: 'Remove Silences',
  fillers: 'Remove Filler Words',
  bleep: 'Bleep Bad Words',
  hookTitle: 'Add Hook Title',
});

const SKIP_REASONS: Readonly<Record<RecipeSkip['reason'], string>> = Object.freeze({
  no_transcript: 'nothing in it was listened to yet',
  no_speech: 'we could not hear anyone',
  not_offered: 'it is not offered for this shape',
  clip_too_short: 'the clip would be too short',
  nothing_found: 'there was nothing to change',
  no_faces: 'we could not find anyone to follow',
});

/** "Follow The Speaker was skipped: we could not find anyone to follow." */
export function skipSentence(skip: RecipeSkip): string {
  return `${PART_NAMES[skip.part]} was skipped: ${SKIP_REASONS[skip.reason]}.`;
}

/** Every skipped part in one line (one sentence each), or null when nothing was skipped. */
export function skippedLine(skipped: readonly RecipeSkip[]): string | null {
  const seen = new Set<string>();
  const sentences: string[] = [];
  for (const skip of skipped) {
    const key = `${skip.part}:${skip.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sentences.push(skipSentence(skip));
  }
  return sentences.length > 0 ? sentences.join(' ') : null;
}

/** The missing parts from the server and from the engine, each once. */
export function mergeMissing(...lists: ReadonlyArray<readonly RecipeMissing[]>): RecipeMissing[] {
  const seen = new Set<string>();
  const out: RecipeMissing[] = [];
  for (const list of lists) {
    for (const missing of list) {
      const key = `${missing.part}:${missing.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(missing);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** The parts that need the words of what the clip plays. */
const WORD_PARTS = ['captions', 'silences', 'fillers', 'bleep', 'hookTitle'] as const;

/** The recipe's word parts only: what a second step applies once the clip was listened to. */
export function wordParts(settings: RecipeSettings): RecipeSettings {
  const out: RecipeSettings = { version: settings.version };
  for (const part of WORD_PARTS) {
    if (settings[part] !== undefined) Object.assign(out, { [part]: settings[part] });
  }
  return out;
}

/** True when the recipe switches on a part that needs words. */
export function needsWords(settings: RecipeSettings): boolean {
  return WORD_PARTS.some((part) => settings[part]?.on === true);
}

/** Every part of a kit, as a recipe applies it. */
export const ALL_BRAND_PARTS: BrandParts = Object.freeze({
  logo: true,
  intro: true,
  outro: true,
  captions: true,
});

/** What the editor has for the engine's context. */
export interface RecipeContextInput {
  videoSize: RecipeContext['videoSize'];
  /** The clip's spoken words, or null when nothing it plays was listened to. */
  transcript: TranscriptView | null;
  /** The workspace's caption styles (built-in ones are known without them). */
  styles: readonly CaptionStyleView[];
  /** The workspace's saved layouts. */
  layouts: readonly SavedLayoutView[];
  /** The shape the clip has once the recipe's shape is applied. */
  ratio: Ratio;
  isLoud?: (range: MsRange) => boolean;
  hookTitleText?: string | null;
  /** My Words, for Bleep Bad Words. */
  workspaceWords?: readonly string[];
}

type SavedLayout = NonNullable<ReturnType<RecipeContext['layoutPreset']>>;

/** A saved layout as a recipe applies it (a followed one gives back its own boxes). */
function savedLayoutOf(view: SavedLayoutView): SavedLayout {
  const { follow, ...rest } = view.layout;
  return follow ? follow.saved : rest;
}

export function captionLookOf(styles: readonly CaptionStyleView[]) {
  return (styleId: string): CaptionLook | null =>
    styles.find((style) => style.id === styleId)?.look ??
    builtInCaptionStyle(styleId)?.look ??
    null;
}

export function recipeContext(input: RecipeContextInput): RecipeContext {
  const transcript = input.transcript;
  return {
    videoSize: input.videoSize,
    transcript:
      transcript && transcript.words.length + transcript.covered.length > 0
        ? {
            assetId: transcript.id,
            language: transcript.language,
            words: transcript.words,
            covered: transcript.covered,
          }
        : null,
    captionLook: captionLookOf(input.styles),
    layoutPreset: (presetId) => {
      const view = input.layouts.find((layout) => layout.id === presetId);
      return view && view.ratio === input.ratio ? savedLayoutOf(view) : null;
    },
    ...(input.isLoud ? { isLoud: input.isLoud } : {}),
    hookTitleText: input.hookTitleText ?? null,
    bleepLists: {
      language: transcript?.language ?? 'en',
      workspace: input.workspaceWords ?? [],
    },
  };
}

/**
 * The recipe on the clip as one change: the engine's edits, then the
 * recipe's brand kit when it names one, and the recipe's id on the clip.
 * Never throws for a missing part (the outcome says what was used instead).
 */
export function recipeChange(
  doc: ClipDocument,
  settings: RecipeSettings,
  ctx: RecipeContext,
  options: { recipeId: string; brandKit: ClipBrandKit | null },
): RecipeOutcome {
  const outcome = applyRecipe(doc, settings, ctx);
  let next = outcome.doc;
  if (options.brandKit) {
    next = applyBrandKit(next, options.brandKit, ALL_BRAND_PARTS, {
      captionLook: ctx.captionLook,
    });
  }
  if (next.recipeId !== options.recipeId) next = { ...next, recipeId: options.recipeId };
  return { ...outcome, doc: next };
}
