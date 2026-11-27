/**
 * Clip Setup's arithmetic (Sprint 13, Module 05), apart from React.
 *
 * The form holds one `ClipSetup` (the same shape the API checks) in a
 * reducer; every change asks the API for the price again. The lines, the
 * button's label and the "you have too few AI minutes" sentence are worked
 * out here.
 *
 * Module 10: a recipe fills every control it covers (`fillFromRecipe`); a
 * control changed afterwards is marked (`changedControls`), and Save As
 * Recipe is offered under the picker once anything differs.
 */
import { refusalMessage } from '@postgear/entitlements';
import {
  aiMinutesCost,
  CLIP_LENGTH_LABELS,
  canFollow,
  type ClipLength,
  type ClipSetup,
  formatClipLength,
  GENRE_LABELS,
  type Genre,
  type Ratio,
  type RecipeSettings,
  SETUP_STEP_LABELS,
  type SetupStep,
} from '@postgear/video-engine';
import type { SetupPriceView } from '@/types/clips';
import { formatDayMonth } from '../home/home-model';

export const REQUEST_PLACEHOLDER = 'Enter your idea';
export const RANGE_HELP = 'Use less of the video to spend fewer AI minutes.';
export const GENRE_HELP = 'Tells the finder what a good moment looks like in this kind of video.';
export const HONEST_LINE =
  'AI listens to what is said and looks at sound and picture. It can be wrong.';
export const PAY_FOR_LOOKING = 'You pay for looking, even when nothing stands out.';

/** Suggestions under the request box: they fill it in when pressed. */
export const REQUEST_EXAMPLES = [
  'Funny moments',
  'Strong opinions',
  'Tips people can use',
] as const;

/** The shapes offered here (the editor offers 4:5 as well). */
export const SETUP_RATIOS: ReadonlyArray<{ value: Ratio; label: string }> = [
  { value: '9:16', label: 'Vertical' },
  { value: '16:9', label: 'Horizontal' },
  { value: '1:1', label: 'Square' },
];

export const LENGTH_OPTIONS = (Object.keys(CLIP_LENGTH_LABELS) as ClipLength[]).map((value) => ({
  value,
  label: CLIP_LENGTH_LABELS[value],
}));

export const GENRE_OPTIONS = (Object.keys(GENRE_LABELS) as Genre[]).map((value) => ({
  value,
  label: GENRE_LABELS[value],
}));

export type SetupAction =
  | { type: 'range'; fromMs: number; toMs: number }
  | { type: 'request'; request: string }
  | { type: 'genre'; genre: Genre }
  | { type: 'length'; length: ClipLength }
  | { type: 'ratio'; ratio: Ratio }
  | { type: 'language'; language: string }
  | { type: 'captions'; on: boolean }
  | { type: 'captionStyle'; styleId: string }
  | { type: 'action'; on: boolean }
  | { type: 'follow'; on: boolean }
  | { type: 'silences'; on: boolean }
  | { type: 'hookTitle'; on: boolean }
  /** Module 10: a recipe picked (it fills what it covers), or None. */
  | {
      type: 'recipe';
      recipe: { id: string; settings: RecipeSettings; brandKitId: string | null } | null;
    }
  | { type: 'brandKit'; brandKitId: string | null };

export function setupReducer(setup: ClipSetup, action: SetupAction): ClipSetup {
  switch (action.type) {
    case 'range':
      return { ...setup, range: { fromMs: action.fromMs, toMs: action.toMs } };
    case 'request':
      return { ...setup, request: action.request.slice(0, 300) };
    case 'genre':
      return { ...setup, genre: action.genre };
    case 'length':
      return { ...setup, length: action.length };
    case 'ratio':
      // Module 08: a wide shape cannot follow the speaker (the API refuses the pair).
      return { ...setup, ratio: action.ratio, follow: setup.follow && canFollow(action.ratio) };
    case 'language':
      return { ...setup, language: action.language };
    case 'captions':
      return { ...setup, captions: { ...setup.captions, on: action.on } };
    case 'captionStyle':
      return { ...setup, captions: { ...setup.captions, styleId: action.styleId } };
    case 'action':
      return { ...setup, action: action.on };
    case 'follow':
      return { ...setup, follow: action.on && canFollow(setup.ratio) };
    case 'silences':
      return { ...setup, silences: action.on };
    case 'hookTitle':
      return { ...setup, hookTitle: action.on };
    case 'recipe': {
      if (!action.recipe) return { ...setup, recipeId: null };
      const filled = fillFromRecipe(setup, action.recipe.settings);
      return {
        ...filled,
        recipeId: action.recipe.id,
        // A recipe that names a kit brings it; one that does not keeps the kit picked.
        brandKitId: action.recipe.brandKitId ?? setup.brandKitId,
      };
    }
    case 'brandKit':
      return { ...setup, brandKitId: action.brandKitId };
  }
}

// ---------------------------------------------------------------------------
// Module 10: recipes on Clip Setup
// ---------------------------------------------------------------------------

/** The controls a recipe can fill (and that show a dot once changed). */
export type SetupControl =
  | 'ratio'
  | 'length'
  | 'genre'
  | 'captions'
  | 'follow'
  | 'silences'
  | 'hookTitle';

/** The setup with every control the recipe covers filled from it; the rest kept. */
export function fillFromRecipe(setup: ClipSetup, settings: RecipeSettings): ClipSetup {
  const ratio = settings.ratio ?? setup.ratio;
  return {
    ...setup,
    ratio,
    length: settings.clipLength ?? setup.length,
    genre: settings.genre ?? setup.genre,
    captions: settings.captions
      ? { on: settings.captions.on, styleId: settings.captions.styleId }
      : setup.captions,
    follow: (settings.follow ? settings.follow.on : setup.follow) && canFollow(ratio),
    silences: settings.silences ? settings.silences.on : setup.silences,
    hookTitle: settings.hookTitle ? settings.hookTitle.on : setup.hookTitle,
  };
}

/** The controls the recipe covers that now differ from what it filled in. */
export function changedControls(
  setup: ClipSetup,
  settings: RecipeSettings | null,
): ReadonlySet<SetupControl> {
  const changed = new Set<SetupControl>();
  if (!settings) return changed;
  const filled = fillFromRecipe(setup, settings);
  if (settings.ratio && setup.ratio !== settings.ratio) changed.add('ratio');
  if (settings.clipLength && setup.length !== settings.clipLength) changed.add('length');
  if (settings.genre && setup.genre !== settings.genre) changed.add('genre');
  if (
    settings.captions &&
    (setup.captions.on !== settings.captions.on ||
      (settings.captions.on && setup.captions.styleId !== settings.captions.styleId))
  ) {
    changed.add('captions');
  }
  if (settings.follow && setup.follow !== filled.follow) changed.add('follow');
  if (settings.silences && setup.silences !== settings.silences.on) changed.add('silences');
  if (settings.hookTitle && setup.hookTitle !== settings.hookTitle.on) changed.add('hookTitle');
  return changed;
}

/**
 * Whether Save As Recipe is offered: a recipe was picked and a control it
 * covers changed, or none was picked and a control differs from the page's
 * first setup.
 */
export function offersSaveAsRecipe(
  setup: ClipSetup,
  settings: RecipeSettings | null,
  initial: ClipSetup,
): boolean {
  if (settings) return changedControls(setup, settings).size > 0;
  return (
    setup.ratio !== initial.ratio ||
    setup.length !== initial.length ||
    setup.genre !== initial.genre ||
    setup.captions.on !== initial.captions.on ||
    (setup.captions.on && setup.captions.styleId !== initial.captions.styleId) ||
    setup.follow !== initial.follow ||
    setup.silences !== initial.silences ||
    setup.hookTitle !== initial.hookTitle
  );
}

/** Module 10: the new switches' help lines. */
export const SILENCES_HELP = 'Cuts the long pauses out of every clip.';
export const HOOK_TITLE_HELP = 'Puts a short title from the clip at its start.';
export const RECIPE_HELP = 'A recipe fills in the choices below. Change any of them after.';
export const CHANGED_MARK = 'Changed from the recipe';
export const SETUP_RECIPE_PLACEHOLDER = 'Enter your recipe name';

/** Module 06: Look For Action's help line, and the one added when stills are shown to AI. */
export const ACTION_HELP =
  'Finds sudden action in the picture. It does not know the rules of your game.';
export const ACTION_VISION_NOTE = 'We also look at a few still pictures of each burst.';

/** Module 08: Follow The Speaker's help line, and why it is off when faces cannot be found. */
export const FOLLOW_HELP = 'The frame stays on whoever is talking.';
export const FOLLOW_OFF_NOTE = 'Finding faces is not available right now.';

/** "+3 AI Minutes": what Look For Action adds for the chosen stretch, before it is switched on. */
export function actionPriceLabel(setup: Pick<ClipSetup, 'range'>): string {
  const minutes = aiMinutesCost('action', Math.max(0, setup.range.toMs - setup.range.fromMs));
  return `+${minutesLabel(minutes)}`;
}

/** "12 AI Minutes" on a button; "1 AI Minute". */
export function minutesLabel(minutes: number): string {
  return `${minutes} AI ${minutes === 1 ? 'Minute' : 'Minutes'}`;
}

/** "Find Clips (73 AI Minutes)", or plain "Find Clips" while the price is unknown. */
export function setupButtonLabel(price: Pick<SetupPriceView, 'total'> | null): string {
  return price ? `Find Clips (${minutesLabel(price.total)})` : 'Find Clips';
}

/** One price line as the summary shows it: its name and "15" or "free". */
export function priceLines(
  price: Pick<SetupPriceView, 'lines'>,
): Array<{ step: SetupStep; name: string; value: string }> {
  return price.lines.map((line) => ({
    step: line.step,
    name: SETUP_STEP_LABELS[line.step],
    value: line.aiMinutes > 0 ? String(line.aiMinutes) : 'free',
  }));
}

/** Why Find Clips is off for want of AI minutes, or null when the run fits. */
export function shortfallSentence(
  price: Pick<SetupPriceView, 'total' | 'remaining' | 'cycleEnd'> | null,
): string | null {
  if (!price || price.remaining === null) return null;
  const left = Math.max(0, Math.floor(price.remaining));
  if (left >= price.total) return null;
  if (left === 0) {
    const day = formatDayMonth(price.cycleEnd);
    return `This workspace has used all its AI minutes for this month.${day ? ` They reset on ${day}.` : ''}`;
  }
  return refusalMessage('clips_ai_minutes_used', {
    need: price.total,
    n: left,
    date: new Date(price.cycleEnd),
  });
}

/** The summary's first lines: the stretch, the shape and length, the captions. */
export function summaryLines(
  setup: ClipSetup,
  styleName: string | null,
  recipeName: string | null = null,
): string[] {
  const ratio = SETUP_RATIOS.find((one) => one.value === setup.ratio)?.label ?? setup.ratio;
  const length = CLIP_LENGTH_LABELS[setup.length].toLowerCase();
  const lines = [
    `${formatClipLength(setup.range.toMs - setup.range.fromMs)} of video`,
    `${ratio}, ${setup.length === 'auto' ? 'any length' : length}`,
  ];
  if (recipeName) lines.push(`Recipe: ${recipeName}`);
  if (setup.captions.on) lines.push(`Captions: ${styleName ?? 'On'}`);
  if (setup.action) lines.push('Looking for action');
  if (setup.follow) lines.push('Following the speaker');
  if (setup.silences) lines.push('Removing silences');
  if (setup.hookTitle) lines.push('Hook title');
  if (setup.genre !== 'auto') lines.push(`Genre: ${GENRE_LABELS[setup.genre]}`);
  return lines;
}
