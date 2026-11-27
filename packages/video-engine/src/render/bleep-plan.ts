/**
 * Bleeps and mutes in the clip's own time (Sprint 13, Module 09).
 *
 * A document keeps its bleeps in SOURCE time, so they stay on their words
 * through every edit. The preview and the export need them in OUTPUT time:
 * `bleepRanges(doc)` maps each one through the time map, part by part, so
 *
 * - a bleep over a cut (or a speed change) is split into one piece per part
 *   that plays it; what was cut out of it is gone,
 * - a bleep inside a removed stretch disappears,
 * - a part played at 2x plays its bleep in half the time,
 * - a hook part (`role: 'hook'`) that repeats a stretch plays the bleeps of
 *   that stretch too, as every part does,
 * - a part whose sound the person turned off (volume 0) has no voice to
 *   bleep, so it gets no bleep (no lone tone over a silent part),
 * - a brand intro or outro part (Module 10) is never bleeped.
 *
 * The compiler (`compile.ts`) writes them as research 09 section 5's gate on
 * the joined sound: `aeval` mutes every range with 5 ms ramps at both edges,
 * one `aevalsrc` makes the 1 kHz tone for every bleep-mode range, and `amix`
 * puts the tone over the muted voice. `t` there is output time, so the gate
 * sits after `concat` (and so after every part's speed change).
 *
 * The expressions are a balanced `if(lt(t,m),<left>,<right>)` over the
 * ranges, not research 09's flat sum `R1+R2+...`: FFmpeg's expression parser
 * refuses a flat chain of about 95 terms or more (the crop chains of research
 * 09 section 9; the same failure was seen here at 100 bleeps), and a flat sum
 * evaluates every term at every sample (8 bleeps cost 26 s for a minute of
 * sound, against 7 s with the tree; 300 bleeps through the tree cost 10 s).
 * `if` evaluates one side only, so a sample reads `log2(n)` comparisons and
 * one range. The ranges never overlap, ramps included (`mergeBleepRanges`), so
 * the tree gives exactly the flat sum's value. With one range the text is
 * research 09's recipe as written.
 */
import type { Bleep, ClipDocument } from '../document/schema';
import { placeSegments } from '../time/time-map';
import { msToSeconds } from './types';

/** One bleep (or a piece of one) on the clip's clock, in whole ms (`toMs` exclusive). */
export interface BleepRange {
  /** The document bleep it comes from (pieces of one bleep share it). */
  id: string;
  mode: 'bleep' | 'mute';
  fromMs: number;
  toMs: number;
}

/** A stretch of output time to mute or tone, whole ms. */
export interface BleepSpan {
  fromMs: number;
  toMs: number;
}

/** Every mute edge ramps over this long (research 09 section 5: a hard mute clicked). */
export const BLEEP_RAMP_MS = 5;
/** The bleep's tone and its level. */
export const BLEEP_TONE_HZ = 1_000;
export const BLEEP_TONE_GAIN = 0.35;

type BleepDocument = Pick<ClipDocument, 'segments' | 'bleeps'>;

/** The answer for one bleep list and one segment list (documents are replaced, never changed). */
const cache = new WeakMap<
  readonly Bleep[],
  { segments: ClipDocument['segments']; ranges: readonly BleepRange[] }
>();

function computeRanges(doc: BleepDocument): BleepRange[] {
  const pieces: BleepRange[] = [];
  for (const placed of placeSegments(doc)) {
    const { segment } = placed;
    if (segment.volume === 0) continue;
    // A brand intro or outro (Module 10) is another video: it is never bleeped.
    if (segment.role === 'intro' || segment.role === 'outro') continue;
    for (const bleep of doc.bleeps) {
      if (bleep.source !== segment.source) continue;
      const from = Math.max(bleep.from, segment.sourceIn);
      const to = Math.min(bleep.to, segment.sourceOut);
      if (to <= from) continue;
      const fromMs = Math.min(
        placed.outEnd,
        placed.outStart + Math.round((from - segment.sourceIn) / segment.speed),
      );
      const toMs = Math.min(
        placed.outEnd,
        placed.outStart + Math.round((to - segment.sourceIn) / segment.speed),
      );
      if (toMs > fromMs) pieces.push({ id: bleep.id, mode: bleep.mode, fromMs, toMs });
    }
  }
  pieces.sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs || a.id.localeCompare(b.id, 'en'));
  return pieces;
}

/** The cached ranges: `frameState` reads them on every frame of the preview. */
function cachedRanges(doc: BleepDocument): readonly BleepRange[] {
  if (doc.bleeps.length === 0) return [];
  const hit = cache.get(doc.bleeps);
  if (hit && hit.segments === doc.segments) return hit.ranges;
  const ranges = computeRanges(doc);
  cache.set(doc.bleeps, { segments: doc.segments, ranges });
  return ranges;
}

/**
 * The document's bleeps on the clip's clock, sorted by start: one entry per
 * played piece, each carrying its bleep's id and mode.
 */
export function bleepRanges(doc: BleepDocument): BleepRange[] {
  return cachedRanges(doc).map((range) => ({ ...range }));
}

/** The bleeps sounding at output moment `t` (whole ms): `fromMs <= t < toMs`. */
export function bleepsAt(doc: BleepDocument, t: number): BleepRange[] {
  const active: BleepRange[] = [];
  for (const range of cachedRanges(doc)) {
    if (range.fromMs > t) break;
    if (t < range.toMs) active.push({ ...range });
  }
  return active;
}

/**
 * Sorted, non-overlapping stretches, ramps included: two ranges closer than
 * a ramp would have their ramps add up (a gain below zero), so they become
 * one. Clamped to the clip.
 */
export function mergeBleepRanges(ranges: readonly BleepSpan[], durationMs: number): BleepSpan[] {
  const sorted = ranges
    .map((r) => ({ fromMs: Math.max(0, r.fromMs), toMs: Math.min(durationMs, r.toMs) }))
    .filter((r) => r.toMs > r.fromMs)
    .sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs);
  const merged: BleepSpan[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.fromMs < last.toMs + BLEEP_RAMP_MS) {
      last.toMs = Math.max(last.toMs, range.toMs);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * A balanced lazy sum over sorted, separated ranges: `term` for one range,
 * `if(lt(t,<start of the right half>),<left>,<right>)` for several.
 */
function rangeTree(ranges: readonly BleepSpan[], term: (range: BleepSpan) => string): string {
  if (ranges.length === 1) return term(ranges[0] as BleepSpan);
  const mid = Math.ceil(ranges.length / 2);
  const right = ranges.slice(mid);
  return `if(lt(t,${msToSeconds((right[0] as BleepSpan).fromMs)}),${rangeTree(ranges.slice(0, mid), term)},${rangeTree(right, term)})`;
}

const RAMP = msToSeconds(BLEEP_RAMP_MS);

/** `Rn`: 0 outside the range, 1 inside, 5 ms ramps up at its start and down after its end. */
function muteTerm(range: BleepSpan): string {
  const a = msToSeconds(range.fromMs);
  const b = msToSeconds(range.toMs);
  return `clip((t-${a})/${RAMP},0,1)*clip((${b}+${RAMP}-t)/${RAMP},0,1)`;
}

/** `Gn`: the tone's gate. */
function toneTerm(range: BleepSpan): string {
  return `between(t,${msToSeconds(range.fromMs)},${msToSeconds(range.toMs)})`;
}

/** The plan's bleeps as the two sets the graph needs: every range muted, the bleep-mode ones toned. */
export function bleepSets(
  ranges: readonly BleepRange[],
  durationMs: number,
): { mutes: BleepSpan[]; tones: BleepSpan[] } {
  return {
    mutes: mergeBleepRanges(ranges, durationMs),
    tones: mergeBleepRanges(
      ranges.filter((range) => range.mode === 'bleep'),
      durationMs,
    ),
  };
}

/** The `aeval` gain: `val(0)*(1-(R...))`, `c=same` so both channels are gated. */
export function bleepMuteFilter(mutes: readonly BleepSpan[]): string {
  return `aeval='val(0)*(1-(${rangeTree(mutes, muteTerm)}))':c=same`;
}

/** The one `aevalsrc` tone for every bleep-mode range, stereo, as long as the clip. */
export function bleepToneSource(tones: readonly BleepSpan[], durationMs: number): string {
  return (
    `aevalsrc='${BLEEP_TONE_GAIN}*sin(2*PI*${BLEEP_TONE_HZ}*t)*(${rangeTree(tones, toneTerm)})'` +
    `:s=48000:c=stereo:d=${msToSeconds(durationMs)}`
  );
}
