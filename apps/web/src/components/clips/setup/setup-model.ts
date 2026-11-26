/**
 * Clip Setup's arithmetic (Sprint 13, Module 05), apart from React.
 *
 * The form holds one `ClipSetup` (the same shape the API checks) in a
 * reducer; every change asks the API for the price again. The lines, the
 * button's label and the "you have too few AI minutes" sentence are worked
 * out here.
 */
import { refusalMessage } from '@postgear/entitlements';
import {
  aiMinutesCost,
  CLIP_LENGTH_LABELS,
  type ClipLength,
  type ClipSetup,
  formatClipLength,
  GENRE_LABELS,
  type Genre,
  type Ratio,
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
  | { type: 'action'; on: boolean };

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
      return { ...setup, ratio: action.ratio };
    case 'language':
      return { ...setup, language: action.language };
    case 'captions':
      return { ...setup, captions: { ...setup.captions, on: action.on } };
    case 'captionStyle':
      return { ...setup, captions: { ...setup.captions, styleId: action.styleId } };
    case 'action':
      return { ...setup, action: action.on };
  }
}

/** Module 06: Look For Action's help line, and the one added when stills are shown to AI. */
export const ACTION_HELP =
  'Finds sudden action in the picture. It does not know the rules of your game.';
export const ACTION_VISION_NOTE = 'We also look at a few still pictures of each burst.';

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
export function summaryLines(setup: ClipSetup, styleName: string | null): string[] {
  const ratio = SETUP_RATIOS.find((one) => one.value === setup.ratio)?.label ?? setup.ratio;
  const length = CLIP_LENGTH_LABELS[setup.length].toLowerCase();
  const lines = [
    `${formatClipLength(setup.range.toMs - setup.range.fromMs)} of video`,
    `${ratio}, ${setup.length === 'auto' ? 'any length' : length}`,
  ];
  if (setup.captions.on) lines.push(`Captions: ${styleName ?? 'On'}`);
  if (setup.action) lines.push('Looking for action');
  if (setup.genre !== 'auto') lines.push(`Genre: ${GENRE_LABELS[setup.genre]}`);
  return lines;
}
