/**
 * The Effects tab's four AI rows (Sprint 13, Module 09; blueprint section 7):
 * their names and lines, their sentences, and the small sums behind them.
 * Pure, so the rows and their tests read the same answers.
 *
 * - **Bleep Bad Words**: the clip's spoken words go through the engine's
 *   `findBleepWords` (the language's list plus My Words; no model, free). A
 *   word is ticked when the document's bleeps cover it, so Undo and Redo
 *   tick and untick the list by themselves.
 * - **Add Hook Clip**: the range picker's moves, kept to 1 to 5 seconds and
 *   inside the clip (`moveHookRange`).
 * - **Text To Speech**: the price label, the job's output, and
 *   `addMadeVoice`, the one place the made voice joins the document.
 */
import {
  addSound,
  aiMinutesCost,
  type BleepWord,
  bleepCoversWord,
  type ClipDocument,
  findBleepWords,
  formatClipLength,
  HOOK_MAX_MS,
  HOOK_MIN_MS,
  type HookRange,
  type HookRefusalCode,
  type SoundEditResult,
  type TranscriptWord,
  toOutput,
  wordPlaces,
} from '@postgear/video-engine';
import type { ClipJobView } from '@/types/clips';
import { pricedLabel } from './captions-model';

/** The four AI cards, in order: their names and their one line. */
export const AI_EFFECT_CARDS = [
  { value: 'bleep', name: 'Bleep Bad Words', line: 'Hide words platforms do not like' },
  { value: 'hook-title', name: 'Add Hook Title', line: 'A line on the first seconds' },
  { value: 'hook-clip', name: 'Add Hook Clip', line: 'Open with the best moment' },
  { value: 'voice', name: 'Text To Speech', line: 'Turn words into a voice' },
] as const;
export type AiEffectCard = (typeof AI_EFFECT_CARDS)[number]['value'];

export const ACTION_FAILED = 'That did not work. Check your connection and try again.';

// ---------------------------------------------------------------------------
// Bleep Bad Words
// ---------------------------------------------------------------------------

export const NO_BLEEP_WORDS = 'No words to bleep in this clip.';
export const BLEEP_LISTEN_HELP = 'Listen to this clip to find the words to bleep.';
export const BLEEP_PARTLY_NOTE = 'Part of this clip has not been listened to yet.';
export const BLEEP_LISTENING = 'Listening to what is said';
export const MY_WORDS_PLACEHOLDER = 'Enter your word';
export const MY_WORDS_EMPTY = 'No words of your own yet.';
export const MY_WORDS_HELP = 'These words are bleeped in every clip of this workspace.';

export const BLEEP_ON_SENTENCE = 'Bad words bleeped.';
export const BLEEP_OFF_SENTENCE = 'Bleeps removed.';
export const BLEEP_MUTE_SENTENCE = 'Bad words muted.';
export const BLEEP_TONE_SENTENCE = 'Bad words bleeped with a tone.';
export const bleepWordSentence = (on: boolean) =>
  on ? 'Word bleeped.' : 'Word no longer bleeped.';

export type BleepModeChoice = 'bleep' | 'mute';
export const BLEEP_MODE_OPTIONS = [
  { value: 'bleep', label: 'Bleep' },
  { value: 'mute', label: 'Mute' },
] as const satisfies ReadonlyArray<{ value: BleepModeChoice; label: string }>;

/**
 * The words the clip plays from its main video, as `findBleepWords` reads
 * them: only words the clip plays (a word cut out is never bleeped).
 */
export function playedWords(
  doc: Pick<ClipDocument, 'segments'>,
  words: readonly TranscriptWord[],
  sourceId: string,
): Array<{ index: number; text: string; start: number; end: number }> {
  const places = wordPlaces(doc, { words: [...words] }, sourceId);
  return words
    .filter((word) => places.get(word.i) === 'played')
    .map((word) => ({ index: word.i, text: word.text, start: word.start, end: word.end }));
}

/** The words to bleep in this clip: its played words against the language's list and My Words. */
export function clipBleepWords(
  doc: Pick<ClipDocument, 'segments'>,
  words: readonly TranscriptWord[],
  sourceId: string,
  language: string,
  myWords: readonly string[],
): BleepWord[] {
  return findBleepWords(playedWords(doc, words, sourceId), { language, workspace: myWords });
}

/** Whether the document bleeps this found word now. */
export function isBleeped(
  doc: Pick<ClipDocument, 'bleeps'>,
  sourceId: string,
  word: BleepWord,
): boolean {
  return bleepCoversWord(doc.bleeps, sourceId, { start: word.from, end: word.to });
}

/** The found words the document bleeps now. */
export function tickedWords(
  doc: Pick<ClipDocument, 'bleeps'>,
  sourceId: string,
  found: readonly BleepWord[],
): BleepWord[] {
  return found.filter((word) => isBleeped(doc, sourceId, word));
}

/** The ticked words after one is ticked (`on`) or unticked. */
export function toggleWord(
  ticked: readonly BleepWord[],
  word: BleepWord,
  on: boolean,
): BleepWord[] {
  const rest = ticked.filter((other) => other.wordIndex !== word.wordIndex);
  return on ? [...rest, word].sort((a, b) => a.from - b.from) : rest;
}

/** Where a found word plays on the clip ("0:04"), or null when it no longer plays. */
export function bleepTimeText(doc: ClipDocument, sourceId: string, word: BleepWord): string | null {
  const at = toOutput(doc, sourceId, word.from);
  return at === null ? null : formatClipLength(at);
}

/** The clip time to seek to for a found word, or null. */
export function bleepSeekMs(doc: ClipDocument, sourceId: string, word: BleepWord): number | null {
  return toOutput(doc, sourceId, word.from);
}

/** The longest word My Words takes (the API refuses longer: `word_list_word_too_long`). */
export const MY_WORD_MAX = 40;

/**
 * Typed text as the list keeps it: one lower-case word per space-separated
 * piece ("Two  Words" gives two words; none when nothing is left), since the
 * API takes single words only (`word_list_one_word`).
 */
export function cleanListWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
}

// ---------------------------------------------------------------------------
// Add Hook Title
// ---------------------------------------------------------------------------

export const HOOK_TITLE_PLACEHOLDER = 'Enter your title';
export const HOOK_TITLE_ADDED = 'Hook title added.';
export const HOOK_TITLE_CHANGED = 'Hook title changed.';

// ---------------------------------------------------------------------------
// Add Hook Clip
// ---------------------------------------------------------------------------

/** One arrow press on the range picker; ten with Shift. */
export const HOOK_STEP_MS = 100;
export const HOOK_ADDED = 'Hook added. The clip now opens with it.';
export const HOOK_REMOVED = 'Hook removed.';
export const HOOK_PREVIEW_NOTE = 'Preview plays the hook, then the clip from its start.';

/** "2.5 s", "3 s". */
export function secondsText(ms: number): string {
  const tenths = Math.round(ms / 100) / 10;
  return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)} s`;
}

/** The row's line when the clip has a hook: "Hook: 2.5 s". */
export function hookLengthText(durationMs: number): string {
  return `Hook: ${secondsText(durationMs)}`;
}

/** "From 0:04, 2.5 s long". */
export function hookRangeText(range: HookRange): string {
  return `From ${formatClipLength(range.fromOutputMs)}, ${secondsText(range.toOutputMs - range.fromOutputMs)} long`;
}

/** The range picked before any suggestion: the clip's first 2.5 seconds (or all of a shorter clip). */
export function defaultHookRange(totalMs: number): HookRange {
  return { fromOutputMs: 0, toOutputMs: Math.max(0, Math.min(2_500, totalMs)) };
}

export type HookRangeMove = 'move' | 'start' | 'end';

/**
 * The range after a drag or an arrow: `move` slides it whole, `start` and
 * `end` move one edge. It always stays 1 to 5 seconds long and inside the
 * clip (a clip shorter than a second keeps the whole clip).
 */
export function moveHookRange(
  range: HookRange,
  mode: HookRangeMove,
  deltaMs: number,
  totalMs: number,
): HookRange {
  const total = Math.max(0, totalMs);
  const delta = Number.isFinite(deltaMs) ? Math.round(deltaMs) : 0;
  const from = Math.round(range.fromOutputMs);
  const to = Math.round(range.toOutputMs);
  const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);
  if (mode === 'move') {
    const length = clamp(to - from, Math.min(HOOK_MIN_MS, total), Math.min(HOOK_MAX_MS, total));
    const start = clamp(from + delta, 0, total - length);
    return { fromOutputMs: start, toOutputMs: start + length };
  }
  if (mode === 'start') {
    const lo = Math.max(0, to - HOOK_MAX_MS);
    const hi = Math.max(lo, to - HOOK_MIN_MS);
    return { fromOutputMs: clamp(from + delta, lo, hi), toOutputMs: to };
  }
  const lo = Math.min(total, from + HOOK_MIN_MS);
  const hi = Math.max(lo, Math.min(total, from + HOOK_MAX_MS));
  return { fromOutputMs: from, toOutputMs: clamp(to + delta, lo, hi) };
}

/** Why Add was refused, in one sentence. */
export function hookRefusalSentence(code: HookRefusalCode): string {
  switch (code) {
    case 'hook_too_short':
      return `A hook is at least ${HOOK_MIN_MS / 1000} second. Pick a longer stretch.`;
    case 'hook_too_long':
      return `A hook is at most ${HOOK_MAX_MS / 1000} seconds. Pick a shorter stretch.`;
    case 'too_many_segments':
      return 'This clip has too many parts for a hook. Remove a part first.';
    case 'clip_too_long':
      return 'With a hook this clip would be too long. Trim it first.';
    default:
      return 'This stretch cannot be a hook. Pick another.';
  }
}

// ---------------------------------------------------------------------------
// Text To Speech
// ---------------------------------------------------------------------------

/** The longest line one voice is made from (the API's limit). */
export const VOICE_TEXT_MAX = 500;
export const VOICE_PLACEHOLDER = 'Enter your words';
export const VOICE_LANGUAGE_SENTENCE = 'This voice cannot read this language. Pick another voice.';
export const VOICE_UNSAVED = 'Your latest changes are not saved yet. Try again in a moment.';
export const VOICE_OFF_NOTE =
  'Making a voice is not available right now. Everything else still works.';
export const VOICE_MAKING = 'Making the voice';
export const VOICE_ADDED = 'Voice added at the playhead.';
export const VOICE_NO_OUTPUT = 'The voice was made but could not be added. Try again.';

/** "Make The Voice (1 AI Minute)": priced by the characters typed, as the API charges. */
export function voiceButtonLabel(characters: number): string {
  return pricedLabel('Make The Voice', aiMinutesCost('voice', Math.max(0, characters)));
}

/** "120 / 500". */
export function voiceCountText(characters: number): string {
  return `${characters} / ${VOICE_TEXT_MAX}`;
}

/** What a finished voice job made. */
export interface MadeVoice {
  /** The workspace's own uploaded sound the voice was kept as (the sound item's `{ asset }`). */
  assetId: string;
  durationMs: number;
}

/** The made voice from a finished SPEECH job's result (`assetId`, `durationMs`), or null when it is not there. */
export function madeVoiceOf(job: Pick<ClipJobView, 'result'> | null): MadeVoice | null {
  const assetId = job?.result?.assetId;
  const durationMs = job?.result?.durationMs;
  if (typeof assetId !== 'string' || assetId.length === 0) return null;
  if (typeof durationMs !== 'number' || !(durationMs > 0)) return null;
  return { assetId, durationMs };
}

/**
 * Puts a made voice on the sound row at the playhead, exactly as an uploaded
 * sound is added (`{ asset: assetId }`, a sound effect of the file's length
 * on its moment): one undo step in the editor.
 *
 * The voice job keeps its file as the workspace's own uploaded sound (the
 * same storage and asset kind as Sprint 12's uploads; it also shows in the
 * Uploaded list as "AI Voice"), and its view carries `result.assetId`, so
 * the reference is `{ asset: assetId }`.
 */
export function addMadeVoice(
  doc: ClipDocument,
  output: MadeVoice,
  playheadMs: number,
): SoundEditResult {
  return addSound(doc, { asset: output.assetId }, 'sfx', playheadMs, {
    durationMs: output.durationMs,
  });
}
