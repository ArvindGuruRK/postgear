/**
 * Lower Music Under Speech (Sprint 13, Module 17 item 9). Pure.
 *
 * A music item with `duck` on drops to `DUCK_GAIN` of its own level while
 * someone talks, and comes back up after. "Someone talks" is read from the
 * words of the clip's listened transcript, on the clip's clock
 * (`captionWords`, so a cut, a speed change or a Fade join moves the dips
 * with the words, and a brand intro or outro never dips). Words closer than
 * `DUCK_JOIN_MS` make one stretch, so the music does not pump between words.
 *
 * The curve is linear in gain: down over `DUCK_ATTACK_MS` before the first
 * word of a stretch, back up over `DUCK_RELEASE_MS` after its last. Joining
 * gaps shorter than the two ramps together means two ramps never overlap,
 * so the editor's preview (`frameState`) and the export's `volume`
 * expression (`duckExpression`) draw the same line.
 *
 * Nothing is stored: the stretches are worked out from the words whenever
 * they are needed, so they can never disagree with the transcript after a
 * fix or a new listen. With no listened words, nothing is lowered.
 */
import { captionWords } from '../captions/map';
import type { ClipDocument } from '../document/schema';
import type { MsRange, Transcript } from '../transcript/types';
import { formatNumber } from './filter-text';
import { msToSeconds } from './types';

/** The music's level under speech, as a share of its own volume (about -10 dB). */
export const DUCK_GAIN = 0.3;
/** How long the music takes to go down, ending at the first word. */
export const DUCK_ATTACK_MS = 150;
/** How long it takes to come back up, starting after the last word. */
export const DUCK_RELEASE_MS = 400;
/** Words closer than this make one stretch (more than the two ramps together). */
export const DUCK_JOIN_MS = 700;

/**
 * When someone talks in the clip, as merged stretches on the clip's clock,
 * in time order. `sourceId`: the source whose video the transcript is of
 * (other sources, and brand parts, never dip).
 */
export function speechSpans(
  doc: Pick<ClipDocument, 'segments'> & Partial<Pick<ClipDocument, 'joins'>>,
  transcript: Pick<Transcript, 'words'>,
  options: { sourceId?: string } = {},
): MsRange[] {
  const words = captionWords(doc, { edits: {} }, transcript, options)
    .map((word) => ({ fromMs: word.start, toMs: word.end }))
    .sort((a, b) => a.fromMs - b.fromMs);
  const spans: MsRange[] = [];
  for (const word of words) {
    const last = spans.at(-1);
    if (last && word.fromMs - last.toMs < DUCK_JOIN_MS) {
      last.toMs = Math.max(last.toMs, word.toMs);
    } else {
      spans.push({ ...word });
    }
  }
  return spans;
}

/** How far down a stretch pulls the music at `ms`: 0 (not at all) to 1 (all the way). */
function depthAt(span: MsRange, ms: number): number {
  const down = (ms - (span.fromMs - DUCK_ATTACK_MS)) / DUCK_ATTACK_MS;
  const up = (span.toMs + DUCK_RELEASE_MS - ms) / DUCK_RELEASE_MS;
  return Math.max(0, Math.min(1, down, up));
}

/** The music's gain at clip time `ms` from the speech stretches: 1, or down to `DUCK_GAIN`. */
export function duckGainAt(spans: readonly MsRange[], ms: number): number {
  for (const span of spans) {
    if (ms < span.fromMs - DUCK_ATTACK_MS) break;
    if (ms <= span.toMs + DUCK_RELEASE_MS) return 1 - (1 - DUCK_GAIN) * depthAt(span, ms);
  }
  return 1;
}

/**
 * The stretches that touch a sound playing from clip time `startMs` for
 * `durationMs`, moved onto the sound's own clock (0 at its start), ramps
 * included. What the render plan keeps for one sound.
 */
export function duckSpansFor(
  spans: readonly MsRange[],
  startMs: number,
  durationMs: number,
): MsRange[] {
  return spans
    .filter(
      (span) =>
        span.toMs + DUCK_RELEASE_MS > startMs &&
        span.fromMs - DUCK_ATTACK_MS < startMs + durationMs,
    )
    .map((span) => ({ fromMs: span.fromMs - startMs, toMs: span.toMs - startMs }));
}

/**
 * The `volume` filter's expression for a sound's own stretches (its clock:
 * `t` is 0 at its start), the same line as `duckGainAt`. Each stretch adds
 * `min(clip(down), clip(up))`; ramps never overlap, so the sum is the depth.
 * Written inside single quotes by the compiler (it holds commas).
 */
export function duckExpression(spans: readonly MsRange[]): string {
  const attack = msToSeconds(DUCK_ATTACK_MS);
  const release = msToSeconds(DUCK_RELEASE_MS);
  // `t` minus a moment, written without a double minus when the moment is before the sound.
  const since = (ms: number) => (ms < 0 ? `t+${msToSeconds(-ms)}` : `t-${msToSeconds(ms)}`);
  const terms = spans.map((span) => {
    const to = msToSeconds(span.toMs + DUCK_RELEASE_MS);
    return `min(clip((${since(span.fromMs - DUCK_ATTACK_MS)})/${attack},0,1),clip((${to}-t)/${release},0,1))`;
  });
  return `1-${formatNumber(1 - DUCK_GAIN)}*(${terms.join('+')})`;
}
