/**
 * The preview's bleeps (Sprint 13, Module 09), as arithmetic kept apart from
 * Web Audio so it is tested without a browser.
 *
 * The input is the clip's bleeps in OUTPUT ms (`bleepRanges(doc)` from the
 * engine package: a bleep over a cut is already split, a hook plays its
 * bleeps too). Inside every range the video's own sound is muted; inside a
 * `bleep` range a 1 kHz tone plays at 0.35. Music and sound items are never
 * touched, as in the export.
 *
 * Every edge is a 5 ms straight ramp placed as the export's gate places it
 * (research 09, section 5: `1 - clip((t-a)/0.005,0,1) * clip((b+0.005-t)/0.005,0,1)`):
 * the sound falls from `a` to `a + 5 ms` and rises again from `b` to
 * `b + 5 ms`. The tone follows the same two ramps the other way, so neither
 * edge clicks.
 *
 * `bleepPlan` turns the ranges into gain events on an audio context's clock,
 * from the playhead `playheadMs` heard at context time `nowS` on. Output time
 * runs at the wall clock's pace whatever a part's speed, so one anchor is
 * enough; the layer plans again on every seek, play, hand-over, document
 * change and drift.
 */

import type { BleepRange } from '@postgear/video-engine';

/** The length of each mute and tone edge. */
export const BLEEP_RAMP_MS = 5;
/** The tone's pitch, as the export's `aevalsrc`. */
export const BLEEP_TONE_HZ = 1_000;
/** The tone's level, as the export's `aevalsrc`. */
export const BLEEP_TONE_GAIN = 0.35;

/** One bleep in output ms: the engine's `bleepRanges(doc)` shape, so preview and export share one name. */
export type { BleepRange };

/** A stretch of output time, in ms, at least one ramp long. */
export interface BleepWindow {
  fromMs: number;
  toMs: number;
}

/** One step for an `AudioParam`: hold `value` from `atS`, or ramp straight to it by `atS`. */
export interface ParamEvent {
  kind: 'set' | 'ramp';
  value: number;
  atS: number;
}

/** One tone: an oscillator started at `startS`, stopped at `stopS`, its gain following `gain`. */
export interface TonePlan {
  startS: number;
  stopS: number;
  gain: ParamEvent[];
}

export interface BleepPlan {
  /** The video's sound gate, 1 open and 0 muted. The first event is its value now. */
  gate: ParamEvent[];
  /** The tones still to play or playing now, in order. */
  tones: TonePlan[];
}

/**
 * The ranges sorted and joined where their ramps would meet (a gap under
 * one ramp), each at least one ramp long. Ranges that are not finite or not
 * longer than nothing are dropped.
 */
export function bleepWindows(
  ranges: readonly Pick<BleepRange, 'fromMs' | 'toMs'>[],
): BleepWindow[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.fromMs) && Number.isFinite(r.toMs) && r.toMs > r.fromMs)
    .map((r) => ({
      fromMs: Math.max(0, r.fromMs),
      toMs: Math.max(r.toMs, Math.max(0, r.fromMs) + BLEEP_RAMP_MS),
    }))
    .sort((a, b) => a.fromMs - b.fromMs);
  const merged: BleepWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.fromMs <= last.toMs + BLEEP_RAMP_MS) {
      last.toMs = Math.max(last.toMs, window.toMs);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/** How far into the window `atMs` is: 0 outside, 1 fully inside, a straight line on each ramp. */
function depthAt(window: BleepWindow, atMs: number): number {
  const { fromMs: a, toMs: b } = window;
  if (atMs < a || atMs >= b + BLEEP_RAMP_MS) return 0;
  if (atMs < a + BLEEP_RAMP_MS) return (atMs - a) / BLEEP_RAMP_MS;
  if (atMs < b) return 1;
  return 1 - (atMs - b) / BLEEP_RAMP_MS;
}

/**
 * The gate of the video's own sound at `outputMs` (1 open, 0 muted), with
 * the ramps. The engine uses it frame by frame for a video the audio layer
 * does not carry.
 */
export function bleepGateAt(ranges: readonly BleepRange[], outputMs: number): number {
  let depth = 0;
  for (const window of bleepWindows(ranges)) {
    depth = Math.max(depth, depthAt(window, outputMs));
  }
  return 1 - depth;
}

/**
 * The events that take a param from `rest` to `active` over one window and
 * back, for the part of it still ahead of the playhead. The caller has set
 * the value at the playhead already, so a ramp the playhead is inside of
 * carries on from there in the same straight line.
 */
function windowEvents(
  window: BleepWindow,
  playheadMs: number,
  at: (ms: number) => number,
  rest: number,
  active: number,
): ParamEvent[] {
  const { fromMs: a, toMs: b } = window;
  const events: ParamEvent[] = [];
  if (a >= playheadMs) {
    events.push({ kind: 'set', value: rest, atS: at(a) });
    events.push({ kind: 'ramp', value: active, atS: at(a + BLEEP_RAMP_MS) });
  } else if (a + BLEEP_RAMP_MS > playheadMs) {
    events.push({ kind: 'ramp', value: active, atS: at(a + BLEEP_RAMP_MS) });
  }
  if (b >= playheadMs) {
    events.push({ kind: 'set', value: active, atS: at(b) });
    events.push({ kind: 'ramp', value: rest, atS: at(b + BLEEP_RAMP_MS) });
  } else if (b + BLEEP_RAMP_MS > playheadMs) {
    events.push({ kind: 'ramp', value: rest, atS: at(b + BLEEP_RAMP_MS) });
  }
  return events;
}

/**
 * The gate and the tones from the playhead on: `playheadMs` is heard at
 * context time `nowS`, and output time runs at one second a second.
 * Windows already over are left out; one the playhead is inside of starts
 * at its value there (a seek into the middle of a bleep starts muted, with
 * the tone already sounding).
 */
export function bleepPlan(
  ranges: readonly BleepRange[],
  playheadMs: number,
  nowS: number,
): BleepPlan {
  const at = (ms: number) => nowS + (ms - playheadMs) / 1000;
  const ahead = (window: BleepWindow) => window.toMs + BLEEP_RAMP_MS > playheadMs;

  const gateWindows = bleepWindows(ranges).filter(ahead);
  const gate: ParamEvent[] = [{ kind: 'set', value: bleepGateAt(ranges, playheadMs), atS: nowS }];
  for (const window of gateWindows) {
    gate.push(...windowEvents(window, playheadMs, at, 1, 0));
  }

  const tones: TonePlan[] = [];
  for (const window of bleepWindows(ranges.filter((r) => r.mode === 'bleep')).filter(ahead)) {
    const startS = Math.max(nowS, at(window.fromMs));
    tones.push({
      startS,
      stopS: at(window.toMs + BLEEP_RAMP_MS),
      gain: [
        { kind: 'set', value: BLEEP_TONE_GAIN * depthAt(window, playheadMs), atS: startS },
        ...windowEvents(window, playheadMs, at, 0, BLEEP_TONE_GAIN),
      ],
    });
  }
  return { gate, tones };
}

/** Applies planned events to a param, after dropping whatever it had scheduled from `fromS` on. */
export function applyParamEvents(
  param: AudioParam,
  events: readonly ParamEvent[],
  fromS: number,
): void {
  param.cancelScheduledValues(fromS);
  for (const event of events) {
    if (event.kind === 'set') param.setValueAtTime(event.value, event.atS);
    else param.linearRampToValueAtTime(event.value, event.atS);
  }
}
