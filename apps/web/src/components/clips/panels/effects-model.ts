/**
 * The Effects tab's words and small sums (Module 13 section 5): the three
 * cards, the zoom's amount and timing, the speed line, the fade lengths, the
 * sentences for an edit that was refused, the playhead kept on its video
 * moment through a change of speed, and the filmstrip picture the look tiles
 * are drawn on. Pure, so the panel and its tests read the same answers.
 */
import {
  CLIP_MAX_MS,
  CLIP_MIN_MS,
  type ClipDocument,
  type EditRefusalCode,
  type FilmstripMeta,
  type FilmstripTile,
  MAX_ZOOMS,
  SEGMENT_MIN_MS,
  type Segment,
  SPEEDS,
  type Speed,
  segmentOutputMs,
  tilesInRange,
  toOutput,
  toSource,
  windowsOfZoom,
  ZOOM_EASES,
  type ZoomEaseName,
  type ZoomRefusalCode,
} from '@postgear/video-engine';

/** The three cards, in order: their names and their one line. */
export const EFFECT_CARDS = [
  { value: 'zoom', name: 'Zoom', line: 'Zoom in on a moment' },
  { value: 'speed', name: 'Speed Control', line: 'Slow down or speed up a part' },
  { value: 'looks', name: 'Looks', line: 'Give the whole clip a look' },
] as const;
export type EffectCard = (typeof EFFECT_CARDS)[number]['value'];

export const ZOOM_PICK_NOTE = 'Select a zoom on the timeline to change it.';
export const ZOOM_GONE_NOTE = 'The clip no longer shows the moment this zoom is on.';
export const SPEED_PICK_NOTE = 'Select a part of the video on the timeline.';
export const SPEED_ROUGH_NOTE = 'Very slow sound may sound rough.';

export const ZOOM_LIMIT_SENTENCE = `A clip can have at most ${MAX_ZOOMS} zooms.`;
export const ZOOM_ROOM_SENTENCE = 'There is already a zoom here. Move the playhead first.';
export const SPEED_PART_SENTENCE = `At that speed this part would be shorter than ${SEGMENT_MIN_MS / 1000} seconds.`;
export const SPEED_SHORT_SENTENCE = `At that speed the clip would be shorter than ${CLIP_MIN_MS / 1000} seconds.`;
export const SPEED_LONG_SENTENCE = `At that speed the clip would be longer than ${CLIP_MAX_MS / 60_000} minutes.`;
export const SPEED_FAILED_SENTENCE = 'This part cannot play at that speed.';

/** Why Add Zoom did nothing, or null when there is nothing to say. */
export function addZoomSentence(code: ZoomRefusalCode): string | null {
  switch (code) {
    case 'too_many_zooms':
      return ZOOM_LIMIT_SENTENCE;
    case 'zoom_no_room':
      return ZOOM_ROOM_SENTENCE;
    default:
      return null;
  }
}

/** Why a speed could not be set. */
export function speedSentence(code: EditRefusalCode): string {
  switch (code) {
    case 'segment_too_short':
      return SPEED_PART_SENTENCE;
    case 'clip_too_short':
      return SPEED_SHORT_SENTENCE;
    case 'clip_too_long':
      return SPEED_LONG_SENTENCE;
    default:
      return SPEED_FAILED_SENTENCE;
  }
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/** "1.5x", "2x". */
export function amountText(scale: number): string {
  return `${Math.round(scale * 100) / 100}x`;
}

export const EASE_OPTIONS: ReadonlyArray<{ value: ZoomEaseName; label: string }> = [
  { value: 'snap', label: 'Snap' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'slow', label: 'Slow' },
];

export function easeMsOf(name: ZoomEaseName): number {
  return ZOOM_EASES[name];
}

/**
 * Where a zoom shows in the clip, for its From and For fields: from its
 * first bar's start to its last bar's end. Null when the clip no longer
 * shows any of it (a cut took its moment out).
 */
export function zoomTiming(
  doc: ClipDocument,
  zoomId: string,
): { startMs: number; durationMs: number } | null {
  const windows = windowsOfZoom(doc, zoomId);
  const first = windows[0];
  const last = windows.at(-1);
  if (!first || !last) return null;
  const endMs = Math.max(first.endMs, last.endMs);
  return { startMs: first.startMs, durationMs: endMs - first.startMs };
}

/**
 * A clip moment where the zoom is at its full amount (the middle of its
 * first bar), for the stage while its dot is dragged; null without a bar.
 */
export function fullZoomMoment(doc: ClipDocument, zoomId: string): number | null {
  const first = windowsOfZoom(doc, zoomId)[0];
  return first ? Math.round((first.startMs + first.endMs) / 2) : null;
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

export const SPEED_OPTIONS: ReadonlyArray<{ value: `${Speed}`; label: string }> = SPEEDS.map(
  (speed) => ({ value: `${speed}` as `${Speed}`, label: `${speed}x` }),
);

export function speedOf(value: string): Speed | null {
  const speed = Number(value);
  return (SPEEDS as readonly number[]).includes(speed) ? (speed as Speed) : null;
}

/** "8.0 s". */
export function secondsText(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** The selected part's length now: "8.0 s becomes 4.0 s" off 1x, "This part is 8.0 s long." at 1x. */
export function speedLengthLine(
  segment: Pick<Segment, 'sourceIn' | 'sourceOut' | 'speed'>,
): string {
  const natural = segment.sourceOut - segment.sourceIn;
  if (segment.speed === 1) return `This part is ${secondsText(natural)} long.`;
  return `${secondsText(natural)} becomes ${secondsText(segmentOutputMs(segment))}`;
}

/** Whether to say that very slow sound may sound rough. */
export function soundsRough(speed: number): boolean {
  return speed < 1;
}

/**
 * Where the playhead goes after a change of speed: on the same moment of
 * the video it showed before (in the part that changed, when it holds it),
 * else where it was, kept inside the clip.
 */
export function playheadAfterSpeed(
  before: ClipDocument,
  after: ClipDocument,
  playheadMs: number,
  segmentId: string,
  afterTotalMs: number,
): number {
  const moment = toSource(before, playheadMs);
  const mapped = moment ? toOutput(after, moment.sourceId, moment.sourceMs, segmentId) : null;
  return Math.min(Math.max(0, mapped ?? playheadMs), afterTotalMs);
}

// ---------------------------------------------------------------------------
// Looks and fades
// ---------------------------------------------------------------------------

export const FADE_LENGTHS = [500, 1_000, 2_000] as const;
export type FadeLength = (typeof FADE_LENGTHS)[number];
export const FADE_DEFAULT_MS: FadeLength = 1_000;

export const FADE_OPTIONS: ReadonlyArray<{ value: `${FadeLength}`; label: string }> = [
  { value: '500', label: '0.5 s' },
  { value: '1000', label: '1 s' },
  { value: '2000', label: '2 s' },
];

/** The fade length the choice shows: the nearest of 0.5, 1 and 2 seconds. */
export function fadeChoice(ms: number): FadeLength {
  let best: FadeLength = FADE_DEFAULT_MS;
  let gap = Number.POSITIVE_INFINITY;
  for (const length of FADE_LENGTHS) {
    const off = Math.abs(length - ms);
    if (off < gap) {
      gap = off;
      best = length;
    }
  }
  return best;
}

export function fadeOf(value: string): FadeLength | null {
  const ms = Number(value);
  return (FADE_LENGTHS as readonly number[]).includes(ms) ? (ms as FadeLength) : null;
}

/**
 * The filmstrip picture of the video moment at the playhead, which the look
 * tiles are drawn on; null without a strip or outside the clip.
 */
export function sampleTile(
  doc: ClipDocument,
  meta: FilmstripMeta | null,
  playheadMs: number,
): FilmstripTile | null {
  if (!meta) return null;
  const moment = toSource(doc, Math.max(0, playheadMs));
  if (!moment) return null;
  const at = tilesInRange(meta, moment.sourceMs, moment.sourceMs + 1)[0];
  if (at) return at;
  // Past the strip's last picture (the end of the video): its last one.
  const lastMs = Math.max(0, (meta.count - 1) * meta.intervalMs);
  return tilesInRange(meta, lastMs, lastMs + 1)[0] ?? null;
}
