/**
 * The Captions tab's facts and sentences (Sprint 13, Module 03). Pure, so the
 * panel, the editor and their tests read one definition.
 *
 * The document change for every control lives here too: each answers a new
 * captions track (or a new document), and the editor commits it as one undo
 * step.
 */
import {
  builtInCaptionStyle,
  CAPTION_MAX_WORDS,
  CAPTION_SIZE_MAX,
  CAPTION_SIZE_MIN,
  CAPTION_WORD_MAX,
  type CaptionCase,
  type CaptionLayout,
  type CaptionLook,
  type CaptionMarkKind,
  type CaptionsTrack,
  captionLookSchema,
  DEFAULT_CAPTION_STYLE,
  displayWord,
  isUnsure,
  MAX_CAPTION_EDITS,
  type TranscriptWord,
} from '@postgear/video-engine';
import type { CaptionStyleView, TranscriptView } from '@/types/clips';

export const CAPTIONS_OFF =
  'Captions from speech are not available right now. You can still upload a captions file.';
export const CAPTIONS_GONE =
  "We could not find this clip's captions. Remove them and add them again.";
export const CAPTIONS_LOAD_FAILED = 'The captions could not be loaded. Check your connection.';
export const CAPTIONS_LISTENING = 'Listening to this clip. You can keep editing.';
export const CAPTIONS_PAGE_ONLY = 'These captions highlight a whole line at a time, not one word.';
export const CAPTIONS_FILE_HINT = 'SRT or VTT, up to 2 MB.';
export const CAPTIONS_FILE_TYPES = '.srt,.vtt,text/vtt,application/x-subrip,text/plain';
export const CAPTION_EDITS_FULL = `A clip keeps up to ${MAX_CAPTION_EDITS} caption changes. Undo one to make another.`;
export const STYLE_NAME_PLACEHOLDER = 'Enter your style name';
export const WORD_PLACEHOLDER = 'Enter your word';
export const MAX_STYLE_NAME_LENGTH = 40;

export const LANGUAGE_AUTO = 'auto';
export const LANGUAGE_AUTO_NAME = 'Detect Automatically';

export const CASE_OPTIONS: ReadonlyArray<{ value: CaptionCase; label: string }> = [
  { value: 'as_spoken', label: 'As Spoken' },
  { value: 'upper', label: 'Capitals' },
  { value: 'lower', label: 'Lowercase' },
];

export const MARK_OPTIONS: ReadonlyArray<{ value: CaptionMarkKind; label: string; line: string }> =
  [
    { value: 'colour', label: 'Colour', line: 'The spoken word changes colour' },
    { value: 'box', label: 'Box', line: 'A box sits behind the spoken word' },
    { value: 'fill', label: 'Fill', line: 'Words keep the colour once said' },
    { value: 'reveal', label: 'Reveal', line: 'Words appear as they are said' },
    { value: 'none', label: 'None', line: 'The whole line shows at once' },
  ];

export type CaptionBacking = 'outline' | 'box' | 'none';
export const BACKING_OPTIONS: ReadonlyArray<{ value: CaptionBacking; label: string }> = [
  { value: 'outline', label: 'Outline' },
  { value: 'box', label: 'Box' },
  { value: 'none', label: 'None' },
];

/** Where the block sits, as three named places (the slider moves it freely). */
export const PLACE_OPTIONS: ReadonlyArray<{ value: string; label: string; y: number }> = [
  { value: 'top', label: 'Top', y: 0.2 },
  { value: 'middle', label: 'Middle', y: 0.5 },
  { value: 'bottom', label: 'Bottom', y: 0.72 },
];

export const SIZE_RANGE = {
  min: Math.max(CAPTION_SIZE_MIN, 32),
  max: Math.min(CAPTION_SIZE_MAX, 160),
};
export const WORDS_RANGE = { min: 1, max: Math.min(CAPTION_MAX_WORDS, 8) };

/** "Add Captions (2 AI Minutes)", or "Add Captions" when it costs nothing. */
export function pricedLabel(action: string, price: number): string {
  if (!(price > 0)) return action;
  return `${action} (${price} AI ${price === 1 ? 'Minute' : 'Minutes'})`;
}

/** The look a style id draws with: one of the listed styles, else the default's. */
export function lookOf(styleId: string, styles: readonly CaptionStyleView[]): CaptionLook {
  const listed = styles.find((style) => style.id === styleId);
  if (listed) return listed.look;
  return (builtInCaptionStyle(styleId) ?? builtInCaptionStyle(DEFAULT_CAPTION_STYLE))
    ?.look as CaptionLook;
}

/** True when the track names a style that is neither built in nor listed (it was deleted). */
export function styleIsGone(styleId: string, styles: readonly CaptionStyleView[]): boolean {
  return !builtInCaptionStyle(styleId) && !styles.some((style) => style.id === styleId);
}

/** Picking a style takes its size and words at once, and drops the track's own overrides. */
export function withStyle(track: CaptionsTrack, style: CaptionStyleView): CaptionsTrack {
  const { letterCase: _case, markColour: _mark, ...rest } = track;
  return { ...rest, styleId: style.id, sizePx: style.look.sizePx, maxWords: style.look.maxWords };
}

export function withSize(track: CaptionsTrack, sizePx: number): CaptionsTrack {
  return {
    ...track,
    sizePx: Math.min(SIZE_RANGE.max, Math.max(SIZE_RANGE.min, Math.round(sizePx))),
  };
}

export function withMaxWords(track: CaptionsTrack, maxWords: number): CaptionsTrack {
  return {
    ...track,
    maxWords: Math.min(WORDS_RANGE.max, Math.max(WORDS_RANGE.min, Math.round(maxWords))),
  };
}

/** The style's own case is stored as "no override", so a style change later still applies. */
export function withCase(
  track: CaptionsTrack,
  letterCase: CaptionCase,
  look: CaptionLook,
): CaptionsTrack {
  const { letterCase: _old, ...rest } = track;
  return letterCase === look.letterCase ? rest : { ...rest, letterCase };
}

export function withMarkColour(
  track: CaptionsTrack,
  hex: string,
  look: CaptionLook,
): CaptionsTrack {
  const { markColour: _old, ...rest } = track;
  const colour = hex.toUpperCase();
  return colour === look.mark.colour.toUpperCase() ? rest : { ...rest, markColour: colour };
}

/** The block's centre line, kept on the canvas with room for two lines. */
export function withPlace(track: CaptionsTrack, y: number): CaptionsTrack {
  const held = Math.min(0.92, Math.max(0.08, Math.round(y * 1000) / 1000));
  return { ...track, position: { ...track.position, y: held } };
}

/** The named place the block is at, or '' between them. */
export function placeOf(track: Pick<CaptionsTrack, 'position'>): string {
  return PLACE_OPTIONS.find((place) => Math.abs(place.y - track.position.y) < 0.005)?.value ?? '';
}

/**
 * This clip's own change to one word: other text, or hidden. A text equal to
 * the word as heard removes the change, as does showing a hidden word. Null
 * when the clip already keeps as many changes as it can.
 */
export function withWordEdit(
  track: CaptionsTrack,
  word: Pick<TranscriptWord, 'i' | 'text'>,
  change: { text?: string; hidden?: boolean },
): CaptionsTrack | null {
  const key = String(word.i);
  const current = Object.hasOwn(track.edits, key) ? track.edits[key] : undefined;
  const text =
    change.text !== undefined
      ? change.text.replace(/\s+/g, ' ').trim().slice(0, CAPTION_WORD_MAX)
      : current?.text;
  const hidden = change.hidden !== undefined ? change.hidden : (current?.hidden ?? false);
  const next: { text?: string; hidden?: boolean } = {};
  if (text !== undefined && text.length > 0 && text !== word.text) next.text = text;
  if (hidden) next.hidden = true;

  const edits = { ...track.edits };
  if (next.text === undefined && !next.hidden) {
    delete edits[key];
  } else {
    if (!current && Object.keys(edits).length >= MAX_CAPTION_EDITS) return null;
    edits[key] = next;
  }
  return { ...track, edits };
}

export interface WordChip {
  /** The transcript's own word index. */
  index: number;
  /** As the captions draw it (this clip's change on, the look's case). */
  shown: string;
  /** As heard, with the video's fixes. */
  heard: string;
  hidden: boolean;
  changed: boolean;
  unsure: boolean;
}

export interface WordGroup {
  key: string;
  /** Clip time the group starts at, for seeking. */
  startMs: number;
  words: WordChip[];
}

/**
 * The clip's words for the list, grouped as the captions page them. A hidden
 * word is not on any page, so it is put back beside the page it would have
 * been on (by its place in the transcript), struck through.
 */
export function wordGroups(
  layout: Pick<CaptionLayout, 'pages' | 'look'>,
  track: Pick<CaptionsTrack, 'edits'>,
  transcript: Pick<TranscriptView, 'words'>,
): WordGroup[] {
  const byIndex = new Map(transcript.words.map((word) => [word.i, word] as const));
  const chip = (index: number, hidden: boolean): WordChip | null => {
    const word = byIndex.get(index);
    if (!word) return null;
    const edit = Object.hasOwn(track.edits, String(index)) ? track.edits[String(index)] : undefined;
    const text = edit?.text ?? word.text;
    return {
      index,
      shown: displayWord(text, layout.look.letterCase) || text,
      heard: word.text,
      hidden,
      changed: edit?.text !== undefined,
      unsure: isUnsure(word) && edit?.text === undefined,
    };
  };

  const groups: WordGroup[] = layout.pages.map((page) => ({
    key: `page-${page.index}`,
    startMs: page.start,
    words: page.words
      .map((word) => chip(word.i, false))
      .filter((item): item is WordChip => item !== null),
  }));

  const hidden = Object.entries(track.edits)
    .filter(([, edit]) => edit.hidden)
    .map(([key]) => Number(key))
    .filter((index) => byIndex.has(index))
    .sort((a, b) => a - b);
  for (const index of hidden) {
    const item = chip(index, true);
    if (!item) continue;
    // The first group holding a later word takes it; else the last group.
    const home =
      groups.find((group) => group.words.some((word) => word.index > index)) ??
      groups[groups.length - 1];
    if (!home) {
      groups.push({ key: `hidden-${index}`, startMs: 0, words: [item] });
      continue;
    }
    const at = home.words.findIndex((word) => word.index > index);
    home.words.splice(at === -1 ? home.words.length : at, 0, item);
  }
  return groups.filter((group) => group.words.length > 0);
}

/** How a look is backed, for the Create A Style form. */
export function backingOf(look: CaptionLook): CaptionBacking {
  return look.outline ? 'outline' : look.box ? 'box' : 'none';
}

/**
 * A look with one thing changed, kept drawable: a box behind the spoken word
 * has no outline and no page box, only a coloured word can pop, and a page
 * has an outline or a box, never both.
 */
export function editLook(look: CaptionLook, change: Partial<CaptionLook>): CaptionLook {
  let next: CaptionLook = { ...look, ...change };
  if (change.mark) next = { ...next, mark: { ...change.mark } };
  if (next.mark.kind === 'box') next = { ...next, outline: null, box: null };
  if (next.mark.kind !== 'colour' && next.mark.pop) {
    next = { ...next, mark: { ...next.mark, pop: false } };
  }
  if (next.outline && next.box)
    next = change.box ? { ...next, outline: null } : { ...next, box: null };
  return next;
}

export function withBacking(look: CaptionLook, backing: CaptionBacking): CaptionLook {
  if (backing === 'outline') {
    return editLook(
      { ...look, box: null },
      { outline: look.outline ?? { colour: '#000000', width: 7 } },
    );
  }
  if (backing === 'box') {
    return editLook(
      { ...look, outline: null },
      { box: look.box ?? { colour: '#111111', pad: 18 } },
    );
  }
  return { ...look, outline: null, box: null };
}

/** One sentence when a look cannot be saved, or null. */
export function lookProblem(look: CaptionLook): string | null {
  return captionLookSchema.safeParse(look).success
    ? null
    : 'This style cannot be drawn. Change the highlight or the backing.';
}

/** The look a clip's captions are drawn with right now, as a new style's starting point. */
export function lookFromTrack(track: CaptionsTrack, look: CaptionLook): CaptionLook {
  return {
    ...look,
    sizePx: track.sizePx,
    maxWords: track.maxWords,
    letterCase: track.letterCase ?? look.letterCase,
    mark: track.markColour ? { ...look.mark, colour: track.markColour } : look.mark,
  };
}

/** A read-only bar on the timeline's Captions row. */
export interface CaptionBar {
  key: string;
  startMs: number;
  endMs: number;
  text: string;
}

export function captionBars(layout: Pick<CaptionLayout, 'pages' | 'look'>): CaptionBar[] {
  return layout.pages.map((page) => ({
    key: `caption-${page.index}`,
    startMs: page.start,
    endMs: page.end,
    text: page.words.map((word) => displayWord(word.text, layout.look.letterCase)).join(' '),
  }));
}
