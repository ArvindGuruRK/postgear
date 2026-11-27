/**
 * `PreviewEngine`: plays a clip in the browser from its light copy, part by
 * part, and draws every layout area from `frameState` (research 05,
 * section 2; Module 08 section 3).
 *
 * - **One clock, in the clip's own time.** While playing, the clock comes
 *   from the front `<video>`'s `requestVideoFrameCallback`: the frame's
 *   `mediaTime` (a moment of the video) is mapped to the clip's time through
 *   the time map, so the playhead is the picture's own time and never a
 *   timer's guess. Where the callback is missing (Firefox before 132) the
 *   engine reads `currentTime` on each animation frame instead: coarser, but
 *   the same mapping.
 * - **Two `<video>` elements on one address.** While a part plays on the
 *   front element, the back one has already sought to the next part's start.
 *   At the join the back one starts (at its part's speed), the front one
 *   pauses, and they change places. A part that continues the one before it
 *   (same video, no gap) is not handed over: the same element plays on, and
 *   only its `playbackRate` changes when the speed does. If the next part is
 *   not ready at the join, the engine holds the last frame and reports
 *   `buffering` until it is, rather than letting the clock drift.
 * - **Speed** is the part's `playbackRate` with `preservesPitch` on. Browsers
 *   may mute sound far from 1x; the export does not (research 05, section 3).
 * - **Scrubbing** (something dragged on the timeline): the playhead follows
 *   at once, the video seeks at most once per animation frame (the latest
 *   moment wins), the sound is muted, and the picture is redrawn on each
 *   `seeked`.
 * - **The document and the address can change at any time.** A new document
 *   keeps playing when the part under the playhead is unchanged and is
 *   re-sought otherwise; the playhead moves to the new end when the clip got
 *   shorter than it. A new address (signed addresses expire) loads at the
 *   current moment and carries on.
 * - **More than one video** (Sprint 13, Module 10; Module 11's montage). A
 *   brand kit's intro and outro, or a montage's parts, come from other
 *   videos: `setExtraSources` gives each of those document sources its own
 *   address, and every other source id plays the main one (`setSource`).
 *   Each element holds the address of the part it is placed on, so the
 *   back one loads and seeks the next part's video ahead of the join. A
 *   join between two videos is always a hand-over (a cut, so the sound
 *   fades in there). A part whose video has no address, or an expired or
 *   failed one, reports its error when the playhead reaches it; seeking to
 *   a playable part, or a fresh address, clears it.
 * - **Fade joins** (Sprint 13, Module 11's montage): the two parts of a
 *   Fade overlap. The hand-over is made at the overlap's start, and the old
 *   front element keeps playing through the overlap (the "mix" element)
 *   while the new one plays the incoming part; the stage draws the
 *   incoming picture over the outgoing one at the join's progress and the
 *   two sounds cross, a quick approximation of the export's `xfade` and
 *   `acrossfade` (Preview Export shows the exact join). Paused, sought or
 *   scrubbed inside an overlap, one picture shows: the part `segmentAt`
 *   answers.
 * - **Bleeps** (Sprint 13, Module 09): on every document change the engine
 *   hands the clip's bleeps in output ms to the audio layer, which mutes the
 *   video's own sound inside each and plays the 1 kHz tone inside bleep-mode
 *   ones on its context clock. A video the layer does not carry is muted
 *   frame by frame through its own volume instead (coarser, no tone).
 * - **Nothing is thrown into React.** A video that cannot load or decode, a
 *   missing or expired address, a draw that fails: each is an `error` on the
 *   snapshot.
 *
 * The engine is an external store: `subscribe` and `getSnapshot` for
 * `useSyncExternalStore`, with a snapshot that changes identity only when a
 * field changes. `destroy()` removes every listener, element and callback.
 *
 * No render library: two `<video>` elements and `<canvas>` only.
 */
import {
  type ClipDocument,
  type FrameState,
  type Segment,
  bleepRanges,
  frameState,
  frameToMs,
  msToFrame,
  outputDuration,
  type SourcePicture,
} from '@postgear/video-engine';
import { type BleepRange, bleepGateAt } from './bleep-schedule';
import { isExpired, mediaErrorOf, previewError } from './errors';
import { EmptyOverlayLayer, SilentAudioLayer } from './layers';
import {
  handoverMs,
  nextHandover,
  outputAt,
  type PreviewPart,
  partAt,
  previewParts,
  seekTargetAt,
} from './parts';
import { PreviewStage } from './stage';
import type {
  AudioLayer,
  FrameScheduler,
  LayerUpdateReason,
  OverlayLayer,
  PreviewError,
  PreviewSnapshot,
  PreviewSource,
  PreviewStats,
} from './types';

export interface PreviewEngineOptions {
  document?: ClipDocument | null;
  source?: PreviewSource | null;
  /** The addresses of the document's other videos, by source id (see `setExtraSources`). */
  extraSources?: Readonly<Record<string, PreviewSource | null>> | null;
  /**
   * Keep the cost spike's numbers on the snapshot (`stats`). Development
   * only: it adds a clock read per frame.
   */
  measure?: boolean;
  /** Text and stickers (Modules 11 and 12). Empty by default. */
  overlayLayer?: OverlayLayer;
  /** Sounds (Module 14). Silent by default. */
  audioLayer?: AudioLayer;
  /**
   * The `crossOrigin` of the two videos. Left unset by default: drawing a
   * cross-origin video onto a canvas works without CORS (the canvas is only
   * marked unreadable), and a bucket without the CORS rule would otherwise
   * refuse to play at all.
   */
  crossOrigin?: 'anonymous' | 'use-credentials' | null;
  /** Makes the `<video>` elements (tests pass fakes; jsdom has no media). */
  createVideo?: () => HTMLVideoElement;
  /** The animation frame clock (tests pass a stepped one). */
  frames?: FrameScheduler;
  /** Milliseconds now, for expiry and the draw timing. */
  now?: () => number;
}

/** What a snapshot reads before an engine exists. */
export const IDLE_PREVIEW_SNAPSHOT: PreviewSnapshot = Object.freeze({
  currentMs: 0,
  durationMs: 0,
  playing: false,
  buffering: false,
  scrubbing: false,
  ready: false,
  error: null,
  stats: null,
});

/** Below this a media moment counts as the part's end (frame times are fractional). */
const JOIN_EPSILON_MS = 0.5;

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number; presentedFrames: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface Slot {
  el: FrameCallbackVideo;
  /** The address the element holds, or null. */
  url: string | null;
  /** The extra source (by id) whose address it holds, or null for the main one. */
  extraId: string | null;
  /** The part this element is placed on (its `key`), or null. */
  partKey: string | null;
  /** The video moment it was asked to show, in ms of source time, or null. */
  targetMs: number | null;
  /** The clip moment that seek was for, to draw the frame it lands on. */
  targetOutputMs: number;
  /** It shows the frame at `targetMs` (its seek finished). */
  ready: boolean;
  frameHandle: number | null;
  /** `presentedFrames` at the last frame callback, for the stats. */
  lastPresented: number | null;
  cleanup: Array<() => void>;
}

function sameError(a: PreviewError | null, b: PreviewError | null): boolean {
  return a === b || (a !== null && b !== null && a.code === b.code && a.message === b.message);
}

function sameStats(a: PreviewStats | null, b: PreviewStats | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.clock === b.clock &&
      a.framesDrawn === b.framesDrawn &&
      a.framesPresented === b.framesPresented &&
      a.averageDrawMs === b.averageDrawMs)
  );
}

function defaultFrames(): FrameScheduler {
  return {
    request: (callback) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(callback)
        : (setTimeout(() => callback(Date.now()), 16) as unknown as number),
    cancel: (handle) =>
      typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame(handle)
        : clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
  };
}

export class PreviewEngine {
  private doc: ClipDocument | null = null;
  private parts: PreviewPart[] = [];
  private durationMs = 0;
  /** The clip's bleeps in output ms. */
  private bleeps: BleepRange[] = [];
  private source: PreviewSource | null = null;
  /** Addresses of the document's other videos, by source id (Module 10). */
  private extras: Record<string, PreviewSource | null> = {};
  /** An extra video that failed to load, by source id, with the address that failed. */
  private readonly failures = new Map<string, { url: string; error: PreviewError }>();
  /** Picture sizes seen per address, for a source not on the front element. */
  private readonly pictureSizes = new Map<string, { width: number; height: number }>();
  /**
   * The source id of the part whose video cannot play, when that is what
   * `error` reports. Null when the error (if any) is the main video's.
   */
  private partErrorSource: string | null = null;

  private readonly slots: [Slot, Slot];
  private front: 0 | 1 = 0;
  /**
   * Module 11: inside a Fade overlap while playing, the element still
   * playing the outgoing part (the back one) and until when (clip ms).
   */
  private mix: { slot: Slot; part: PreviewPart; untilMs: number } | null = null;
  /** One-part views of the document, by part id, for drawing the other side of a Fade. */
  private sideDocs = new Map<string, ClipDocument>();
  private stage: PreviewStage | null = null;
  private readonly overlay: OverlayLayer;
  private readonly audio: AudioLayer;
  private readonly frames: FrameScheduler;
  private readonly now: () => number;
  private readonly measure: boolean;

  /** The playhead, unrounded (a frame's media time is fractional). */
  private clockMs = 0;
  /** The part on the front element. */
  private playingIndex = 0;
  /** Playback was asked for. */
  private wantPlaying = false;
  /** The front element's position matches the clock (after a seek, or a pause in place). */
  private inSync = false;
  /** A seek of the front element is running. */
  private seekPending = false;
  /** Held at a join, waiting for this part (its key) on the back element. */
  private holdingFor: string | null = null;
  /** The network stalled while playing (`waiting`). */
  private stalled = false;
  private scrubbing = false;
  private resumeAfterScrub = false;
  private scrubTarget: number | null = null;
  private scrubFrame: number | null = null;
  private tickFrame: number | null = null;
  private ready = false;
  private error: PreviewError | null = null;
  private destroyed = false;

  private framesDrawn = 0;
  private framesPresented = 0;
  private drawMsTotal = 0;
  private usingFallbackClock = false;

  private readonly listeners = new Set<() => void>();
  private readonly pictureListeners = new Set<(video: HTMLVideoElement) => void>();
  private snapshot: PreviewSnapshot = IDLE_PREVIEW_SNAPSHOT;

  constructor(options: PreviewEngineOptions = {}) {
    this.overlay = options.overlayLayer ?? new EmptyOverlayLayer();
    this.audio = options.audioLayer ?? new SilentAudioLayer();
    this.frames = options.frames ?? defaultFrames();
    this.now =
      options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.measure = options.measure === true;
    const createVideo = options.createVideo ?? (() => document.createElement('video'));
    const crossOrigin = options.crossOrigin ?? null;
    this.slots = [
      this.makeSlot(createVideo(), crossOrigin),
      this.makeSlot(createVideo(), crossOrigin),
    ];
    this.audio.attachVideos?.(this.slots.map((slot) => slot.el));
    if (options.document) {
      this.setDocument(options.document);
    }
    if (options.extraSources) {
      this.setExtraSources(options.extraSources);
    }
    if (options.source !== undefined) {
      this.setSource(options.source);
    }
    this.publish();
  }

  // ---------------------------------------------------------------- store

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PreviewSnapshot => this.snapshot;

  /** The playhead, unrounded: for frame stepping and anything that must not lose the fraction. */
  get exactMs(): number {
    return this.clockMs;
  }

  /** The two `<video>` elements, front first (tests and the cost spike). */
  get videos(): [HTMLVideoElement, HTMLVideoElement] {
    const front = this.slots[this.front].el;
    const back = this.slots[this.front === 0 ? 1 : 0].el;
    return [front, back];
  }

  /** The stage's DOM, once attached (Module 11 places handles over it; Module 13 fills the wrappers). */
  get stageElements(): Pick<PreviewStage, 'root' | 'looks' | 'zoom' | 'overlayHost'> | null {
    return this.stage;
  }

  /**
   * Calls `listener` with the front `<video>` each time the picture at the
   * playhead is drawn (a frame while playing, a finished seek), and once
   * now when one is showing. The Layouts tab's Video pane draws the whole
   * video from it, so the full frame and the clip are always the same
   * moment. A listener's own failure never stops the picture. Returns the
   * way to stop listening.
   */
  onPicture(listener: (video: HTMLVideoElement) => void): () => void {
    if (this.destroyed) return () => undefined;
    this.pictureListeners.add(listener);
    const front = this.slots[this.front];
    if (front.ready && this.doc && this.parts.length > 0) {
      this.tellPicture(listener, front.el);
    }
    return () => {
      this.pictureListeners.delete(listener);
    };
  }

  private tellPicture(listener: (video: HTMLVideoElement) => void, el: HTMLVideoElement): void {
    try {
      listener(el);
    } catch {
      // The pane's own failure; the next frame tries again.
    }
  }

  // -------------------------------------------------------------- the stage

  /** Builds the stage inside `container` (moving it from any earlier one). */
  attach(container: HTMLElement): void {
    if (this.destroyed) return;
    if (!this.stage) {
      this.stage = new PreviewStage(container.ownerDocument);
      this.overlay.mount(this.stage.overlayHost);
    }
    this.stage.mount(container);
    for (const slot of this.slots) {
      this.stage.mediaHost.appendChild(slot.el);
    }
    this.redraw('seek');
  }

  /** Takes the stage out of its container. A video out of the document pauses, so playback does too. */
  detach(): void {
    if (!this.stage || this.destroyed) return;
    this.pause();
    this.stage.unmount();
  }

  // ---------------------------------------------------------- the content

  /** Plays this document from now on. Safe at any time, playing or not. */
  setDocument(doc: ClipDocument): void {
    if (this.destroyed) return;
    this.stopMix(false);
    this.sideDocs.clear();
    const previous = this.parts[this.playingIndex] ?? null;
    const first = this.doc === null;
    this.doc = doc;
    this.parts = previewParts(doc);
    this.durationMs = outputDuration(doc);
    this.setBleeps(doc);
    if (this.clockMs > this.durationMs) {
      this.clockMs = this.durationMs;
    }
    if (this.parts.length === 0) {
      this.stopClock();
      this.publish();
      return;
    }
    if (!this.canSeekVideo()) {
      // No picture to draw, but text and stickers still show where they are.
      this.updateLayers('seek');
      this.publish();
      return;
    }
    if (first || !previous) {
      this.seekFront(this.clockMs);
      this.publish();
      return;
    }

    // The same part (same video range and speed) still plays: carry on from
    // its new place in the clip; anything else is sought again.
    const still = this.parts.find((part) => part.key === previous.key);
    if (still && this.wantPlaying && !this.seekPending && this.holdingFor === null) {
      this.playingIndex = still.index;
      const media = this.mediaMsOf(this.slots[this.front]);
      this.clockMs = outputAt(still, media);
      this.prepareBack(nextHandover(this.parts, still.index));
      this.publish();
      return;
    }
    if (this.wantPlaying || this.holdingFor !== null) {
      this.seekFront(this.clockMs);
      this.publish();
      return;
    }
    // Paused: when the frame on the element is still the right one, only the
    // picture (crop, layout) needs drawing again.
    const part = partAt(this.parts, this.clockMs) as PreviewPart;
    const frontSlot = this.slots[this.front];
    const target = seekTargetAt(part, this.clockMs);
    if (
      this.inSync &&
      frontSlot.ready &&
      frontSlot.targetMs !== null &&
      Math.abs(frontSlot.targetMs - target) < 1 &&
      part.sourceId === previous.sourceId &&
      frontSlot.url === this.urlOf(part.sourceId)
    ) {
      this.playingIndex = part.index;
      frontSlot.partKey = part.key;
      frontSlot.targetOutputMs = this.clockMs;
      this.redraw('seek');
    } else {
      this.seekFront(this.clockMs);
    }
    this.publish();
  }

  /**
   * Plays from this address, at the current moment. Changing the address
   * (a fresh signed one) keeps the playhead and whether it was playing.
   * Null reports `missing_source`.
   */
  setSource(source: PreviewSource | null): void {
    if (this.destroyed) return;
    const url = source?.url ?? null;
    // The same address again is a no-op, unless it failed: then it is a retry.
    if (url !== null && url === this.source?.url && !this.error) {
      // A refreshed expiry or frame rate for the same file.
      this.source = source;
      return;
    }
    this.source = source;
    this.partErrorSource = null;
    this.stopMix(false);
    this.stopClock();
    this.audio.silence();
    this.ready = false;
    this.holdingFor = null;
    this.stalled = false;
    for (const slot of this.slots) {
      slot.partKey = null;
      slot.targetMs = null;
      slot.ready = false;
      slot.el.pause();
    }
    if (!source || !url) {
      this.wantPlaying = false;
      this.seekPending = false;
      for (const slot of this.slots) {
        slot.el.removeAttribute('src');
        slot.el.load();
        slot.url = null;
        slot.extraId = null;
      }
      this.error = previewError('missing_source');
      this.publish();
      return;
    }
    if (isExpired(source, Date.now())) {
      this.wantPlaying = false;
      this.seekPending = false;
      this.error = previewError('source_expired');
      this.publish();
      return;
    }
    this.error = null;
    for (const slot of this.slots) {
      // An element on another video keeps it; it is placed again below.
      if (slot.extraId === null) {
        slot.el.src = url;
        slot.url = url;
      }
    }
    if (this.parts.length > 0) {
      this.seekFront(this.clockMs);
    }
    this.publish();
  }

  /**
   * The addresses of the document's other videos (a brand kit's intro and
   * outro, a montage's parts), keyed by the document's source id. Every
   * source id not in the map plays the main address (`setSource`). Null for
   * an id means that video has no address: its parts report
   * `missing_source` when the playhead reaches them. Safe at any time: only
   * the elements on a source whose address changed are loaded again (the
   * same address after a failure is a retry), at the current moment.
   */
  setExtraSources(sources: Readonly<Record<string, PreviewSource | null>> | null): void {
    if (this.destroyed) return;
    const previous = this.extras;
    const next: Record<string, PreviewSource | null> = { ...(sources ?? {}) };
    const changed = new Set<string>();
    for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      const had = id in previous;
      const has = id in next;
      const before = had ? (previous[id]?.url ?? null) : undefined;
      const after = has ? (next[id]?.url ?? null) : undefined;
      if (before !== after || this.failures.has(id) || this.partErrorSource === id) {
        changed.add(id);
      }
    }
    this.extras = next;
    for (const id of changed) this.failures.delete(id);
    if (changed.size === 0 || this.parts.length === 0 || !this.canSeekVideo()) {
      return;
    }
    const frontSlot = this.slots[this.front];
    const playing = this.parts[this.playingIndex];
    const touches = (slot: Slot): boolean => {
      if (slot.extraId !== null && changed.has(slot.extraId)) return true;
      const part = this.parts.find((entry) => entry.key === slot.partKey);
      return part !== undefined && changed.has(part.sourceId);
    };
    if (
      this.partErrorSource !== null ||
      touches(frontSlot) ||
      (playing !== undefined && changed.has(playing.sourceId))
    ) {
      // The video under the playhead changed: load it again in place, as a
      // new main address does.
      this.stopMix(false);
      this.stopClock();
      this.audio.silence();
      this.ready = false;
      this.holdingFor = null;
      this.stalled = false;
      for (const slot of this.slots) {
        if (!touches(slot)) continue;
        slot.partKey = null;
        slot.targetMs = null;
        slot.ready = false;
        slot.el.pause();
      }
      if (this.partErrorSource !== null) {
        this.error = null;
        this.partErrorSource = null;
      }
      this.seekFront(this.clockMs);
      this.publish();
      return;
    }
    const back = this.backSlot();
    if (touches(back)) {
      back.partKey = null;
      back.targetMs = null;
      back.ready = false;
      if (!back.el.paused) back.el.pause();
    }
    if (this.holdingFor !== null) {
      const held = this.parts.find((part) => part.key === this.holdingFor);
      if (held) this.join(held);
    } else {
      this.prepareBack(nextHandover(this.parts, this.playingIndex));
    }
    this.publish();
  }

  // ----------------------------------------------------------- transport

  play(): void {
    if (this.destroyed || this.wantPlaying || this.parts.length === 0) return;
    if (!this.source || this.error) return;
    // Inside the click: the sound may start only after a gesture.
    this.audio.wake?.();
    if (this.scrubbing) {
      this.resumeAfterScrub = true;
      return;
    }
    if (this.clockMs >= this.durationMs - JOIN_EPSILON_MS) {
      this.clockMs = 0;
      this.inSync = false;
    }
    this.wantPlaying = true;
    if (this.seekPending) {
      // `seeked` starts it.
    } else if (this.inSync && this.slots[this.front].ready) {
      this.startFront('play');
    } else {
      this.seekFront(this.clockMs);
    }
    this.publish();
  }

  pause(): void {
    if (this.destroyed) return;
    if (this.scrubbing) {
      this.resumeAfterScrub = false;
    }
    if (!this.wantPlaying) return;
    this.wantPlaying = false;
    this.stalled = false;
    this.stopClock();
    this.stopMix(true);
    const frontSlot = this.slots[this.front];
    frontSlot.el.pause();
    this.audio.silence();
    if (this.holdingFor !== null) {
      // Held at a join: the clock already shows the next part's start, which
      // the front element does not hold.
      this.holdingFor = null;
      this.inSync = false;
    } else if (!this.seekPending) {
      this.settleOnFront();
    }
    this.publish();
  }

  toggle(): void {
    if (this.wantPlaying || (this.scrubbing && this.resumeAfterScrub)) {
      this.pause();
    } else {
      this.play();
    }
  }

  /** Moves the playhead to `outputMs` (clamped into the clip). Keeps playing if it was. */
  seek(outputMs: number): void {
    if (this.destroyed || this.parts.length === 0) return;
    const target = Math.min(this.durationMs, Math.max(0, Number.isFinite(outputMs) ? outputMs : 0));
    this.clockMs = target;
    this.holdingFor = null;
    if (this.scrubbing) {
      this.scrubTarget = target;
      this.scheduleScrubSeek();
      this.publish();
      return;
    }
    if (this.canSeekVideo()) {
      this.seekFront(target);
    }
    this.publish();
  }

  /** Steps `n` frames of the clip (`doc.canvas.fps`), back when negative. Pauses first. */
  stepFrames(n: number): void {
    if (this.destroyed || !this.doc || !Number.isFinite(n)) return;
    this.pause();
    const fps = this.doc.canvas.fps;
    const frame = msToFrame(this.clockMs, fps) + Math.trunc(n);
    this.seek(frameToMs(Math.max(0, frame), fps));
  }

  /**
   * Scrubbing mode, while something is dragged on the timeline: seeks are
   * throttled to one per animation frame and the sound is muted. Playback
   * pauses for the drag and picks up again when it ends.
   */
  setScrubbing(on: boolean): void {
    if (this.destroyed || on === this.scrubbing) return;
    if (on) {
      const wasPlaying = this.wantPlaying;
      this.pause();
      this.resumeAfterScrub = wasPlaying;
      this.scrubbing = true;
      for (const slot of this.slots) slot.el.muted = true;
      this.publish();
      return;
    }
    this.scrubbing = false;
    if (this.scrubFrame !== null) {
      this.frames.cancel(this.scrubFrame);
      this.scrubFrame = null;
    }
    const pending = this.scrubTarget;
    this.scrubTarget = null;
    if (pending !== null && this.canSeekVideo()) {
      this.seekFront(pending);
    }
    this.applySound(this.slots[this.front], this.parts[this.playingIndex]);
    const resume = this.resumeAfterScrub;
    this.resumeAfterScrub = false;
    if (resume) {
      this.play();
    }
    this.publish();
  }

  /** Removes every listener, element, frame callback and layer. The engine does nothing after. */
  destroy(): void {
    if (this.destroyed) return;
    this.mix = null;
    this.stopClock();
    if (this.scrubFrame !== null) {
      this.frames.cancel(this.scrubFrame);
      this.scrubFrame = null;
    }
    this.audio.silence();
    for (const slot of this.slots) {
      for (const off of slot.cleanup) off();
      slot.cleanup = [];
      slot.el.pause();
      slot.el.removeAttribute('src');
      slot.el.load();
      slot.el.remove();
    }
    this.stage?.unmount();
    this.stage = null;
    this.overlay.destroy();
    this.audio.destroy();
    this.listeners.clear();
    this.pictureListeners.clear();
    this.destroyed = true;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // ------------------------------------------------------------- internals

  private makeSlot(el: HTMLVideoElement, crossOrigin: string | null): Slot {
    const video = el as FrameCallbackVideo;
    video.preload = 'auto';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.disablePictureInPicture = true;
    video.controls = false;
    if (crossOrigin) video.crossOrigin = crossOrigin;
    video.preservesPitch = true;
    const slot: Slot = {
      el: video,
      url: null,
      extraId: null,
      partKey: null,
      targetMs: null,
      targetOutputMs: 0,
      ready: false,
      frameHandle: null,
      lastPresented: null,
      cleanup: [],
    };
    const on = (type: string, handler: () => void) => {
      video.addEventListener(type, handler);
      slot.cleanup.push(() => video.removeEventListener(type, handler));
    };
    on('loadedmetadata', () => this.onLoadedMetadata(slot));
    on('loadeddata', () => this.onLoadedData(slot));
    on('seeked', () => this.onSeeked(slot));
    on('waiting', () => this.onWaiting(slot));
    on('playing', () => this.onPlaying(slot));
    on('ended', () => this.onEnded(slot));
    on('error', () => this.onError(slot));
    return slot;
  }

  private isFront(slot: Slot): boolean {
    return this.slots[this.front] === slot;
  }

  private backSlot(): Slot {
    return this.slots[this.front === 0 ? 1 : 0];
  }

  /** Video moments can be played: a main address, and no error other than one part's own. */
  private canSeekVideo(): boolean {
    return this.source !== null && (this.error === null || this.partErrorSource !== null);
  }

  /** Where a document source plays from: its own extra address, or the main one. */
  private bindingOf(sourceId: string): { extraId: string | null; source: PreviewSource | null } {
    if (Object.hasOwn(this.extras, sourceId)) {
      return { extraId: sourceId, source: this.extras[sourceId] ?? null };
    }
    return { extraId: null, source: this.source };
  }

  private urlOf(sourceId: string): string | null {
    return this.bindingOf(sourceId).source?.url ?? null;
  }

  /**
   * Why `part`'s own video cannot play, or null. Only an extra source is
   * checked here: the main address reports its own problems on `setSource`.
   */
  private problemOf(part: PreviewPart): PreviewError | null {
    const { extraId, source } = this.bindingOf(part.sourceId);
    if (extraId === null) return null;
    if (!source?.url) return previewError('missing_source');
    if (isExpired(source, Date.now())) return previewError('source_expired');
    const failure = this.failures.get(extraId);
    return failure && failure.url === source.url ? failure.error : null;
  }

  /** Stops on part `index`, whose video (`sourceId`) cannot play, and reports why. */
  private reportPartError(index: number, sourceId: string, error: PreviewError): void {
    const frontSlot = this.slots[this.front];
    this.playingIndex = index;
    this.inSync = false;
    this.ready = false;
    // A seek still running on the front element is for a moment no longer shown.
    frontSlot.partKey = null;
    frontSlot.targetMs = null;
    frontSlot.ready = false;
    this.setError(error, sourceId);
  }

  private offsetOf(slot: Slot): number {
    const source = slot.extraId === null ? this.source : (this.extras[slot.extraId] ?? null);
    return source?.offsetMs ?? 0;
  }

  /** The video moment an element shows, in source ms. */
  private mediaMsOf(slot: Slot): number {
    return slot.el.currentTime * 1000 - this.offsetOf(slot);
  }

  /**
   * Asks an element to show `sourceMs` of `part`, loading the part's own
   * video first when it holds another. Before its metadata, the seek waits
   * for it.
   */
  private placeSlot(slot: Slot, part: PreviewPart, sourceMs: number, outputMs: number): void {
    const { extraId, source } = this.bindingOf(part.sourceId);
    const url = source?.url ?? null;
    if (url !== null && slot.url !== url) {
      // A new address starts loading at once (its metadata resets the element).
      slot.el.src = url;
      slot.url = url;
    }
    slot.extraId = extraId;
    slot.partKey = part.key;
    slot.targetMs = sourceMs;
    slot.targetOutputMs = outputMs;
    slot.ready = false;
    if (slot.el.readyState >= 1) {
      slot.el.currentTime = (sourceMs + this.offsetOf(slot)) / 1000;
    }
  }

  /** Seeks the front element to the clip moment `outputMs` and readies the back one for the next join. */
  private seekFront(outputMs: number): void {
    const part = partAt(this.parts, outputMs);
    if (!part || !this.source) return;
    const problem = this.problemOf(part);
    if (problem) {
      this.reportPartError(part.index, part.sourceId, problem);
      return;
    }
    if (this.partErrorSource !== null) {
      // Away from the part that could not play: the error goes with it.
      this.error = null;
      this.partErrorSource = null;
    }
    this.stopClock();
    this.stopMix(false);
    const frontSlot = this.slots[this.front];
    if (!frontSlot.el.paused) frontSlot.el.pause();
    // The picture stops while it seeks, so the sound does too: no tone is
    // left sounding on the old plan. `seeked` starts everything again in place.
    if (this.wantPlaying) this.audio.silence();
    this.holdingFor = null;
    this.playingIndex = part.index;
    this.seekPending = true;
    this.inSync = false;
    this.placeSlot(frontSlot, part, seekTargetAt(part, outputMs), outputMs);
    this.prepareBack(nextHandover(this.parts, part.index));
  }

  /** The back element waits on the start of part `index` (or on nothing). */
  private prepareBack(index: number | null): void {
    // The back element is still playing the outgoing side of a Fade: placed when the mix ends.
    if (this.mix) return;
    const back = this.backSlot();
    if (index === null) {
      // No join ahead. Whatever the back element holds stays, so a seek
      // back to an earlier part finds it still ready.
      return;
    }
    const part = this.parts[index] as PreviewPart;
    if (
      back.partKey === part.key &&
      back.targetMs === part.sourceIn &&
      back.url === this.urlOf(part.sourceId)
    ) {
      return;
    }
    if (this.problemOf(part)) {
      // Its video cannot play: the join reports it.
      return;
    }
    if (!back.el.paused) back.el.pause();
    this.placeSlot(back, part, part.sourceIn, part.outStart);
  }

  private applySound(slot: Slot, part: PreviewPart | undefined): void {
    const volume = part?.volume ?? 1;
    slot.el.muted = this.scrubbing || volume <= 0;
    slot.el.volume = Math.min(1, Math.max(0, volume));
  }

  /**
   * The part's volume times the fade at this moment (`FrameState.videoGain`):
   * through the audio layer when it carries the video's sound (up to 200%),
   * else the element's own volume (at most 100%).
   */
  private applyGain(slot: Slot, gain: number, outputMs: number): void {
    const safe = Math.max(0, Number.isFinite(gain) ? gain : 0);
    // A layer that takes the bleeps gates the sound it carries itself; any
    // other way, the gate is applied here, frame by frame.
    const gate = this.bleeps.length > 0 ? bleepGateAt(this.bleeps, outputMs) : 1;
    const layerGates = typeof this.audio.setBleeps === 'function';
    if (this.audio.videoGain?.(slot.el, layerGates ? safe : safe * gate)) {
      if (slot.el.volume !== 1) slot.el.volume = 1;
      return;
    }
    const volume = Math.min(1, safe * gate);
    if (Math.abs(slot.el.volume - volume) > 0.001) slot.el.volume = volume;
  }

  /** Starts the front element at its part's speed and the clock on it. */
  private startFront(reason: LayerUpdateReason): void {
    const slot = this.slots[this.front];
    const part = this.parts[this.playingIndex];
    if (!part) return;
    slot.el.playbackRate = part.speed;
    slot.el.preservesPitch = true;
    this.applySound(slot, part);
    this.inSync = true;
    const started = slot.el.play();
    if (started && typeof started.catch === 'function') {
      started.catch((cause: unknown) => {
        // Autoplay refused (no gesture yet): stop asking. An abort (paused
        // before it began) is not a failure.
        const name = (cause as { name?: string } | null)?.name;
        if (name === 'NotAllowedError' && this.isFront(slot) && this.wantPlaying) {
          this.wantPlaying = false;
          this.stopClock();
          this.settleOnFront();
          this.publish();
        }
      });
    }
    this.startClock();
    this.updateLayers(reason);
  }

  private startClock(): void {
    this.stopClock();
    const slot = this.slots[this.front];
    if (typeof slot.el.requestVideoFrameCallback === 'function') {
      this.usingFallbackClock = false;
      slot.lastPresented = null;
      slot.frameHandle = slot.el.requestVideoFrameCallback((_now, metadata) =>
        this.onVideoFrame(slot, metadata),
      );
    } else {
      this.usingFallbackClock = true;
      this.tickFrame = this.frames.request(() => this.onAnimationFrame());
    }
  }

  private stopClock(): void {
    for (const slot of this.slots) {
      if (slot.frameHandle !== null) {
        slot.el.cancelVideoFrameCallback?.(slot.frameHandle);
        slot.frameHandle = null;
      }
      slot.lastPresented = null;
    }
    if (this.tickFrame !== null) {
      this.frames.cancel(this.tickFrame);
      this.tickFrame = null;
    }
  }

  private onVideoFrame(slot: Slot, metadata: { mediaTime: number; presentedFrames: number }): void {
    slot.frameHandle = null;
    if (this.destroyed || !this.isFront(slot) || !this.wantPlaying || this.holdingFor !== null) {
      return;
    }
    if (this.measure) {
      const presented = metadata.presentedFrames;
      this.framesPresented +=
        slot.lastPresented === null ? 1 : Math.max(0, presented - slot.lastPresented);
      slot.lastPresented = presented;
    }
    this.advance(metadata.mediaTime * 1000 - this.offsetOf(slot));
    if (
      this.wantPlaying &&
      this.isFront(slot) &&
      slot.frameHandle === null &&
      this.holdingFor === null
    ) {
      slot.frameHandle =
        slot.el.requestVideoFrameCallback?.((_now, next) => this.onVideoFrame(slot, next)) ?? null;
    }
  }

  private onAnimationFrame(): void {
    this.tickFrame = null;
    if (this.destroyed || !this.wantPlaying || this.holdingFor !== null || this.seekPending) {
      return;
    }
    this.advance(this.mediaMsOf(this.slots[this.front]));
    if (this.wantPlaying && this.holdingFor === null && this.tickFrame === null) {
      this.tickFrame = this.frames.request(() => this.onAnimationFrame());
    }
  }

  /**
   * The clock's one step: the front element shows `sourceMs`. Walks on
   * through parts that continue on the same element, hands over or holds at
   * a join, stops at the clip's end, and otherwise draws the moment.
   */
  private advance(sourceMs: number): void {
    let index = this.playingIndex;
    let part = this.parts[index];
    if (!part) return;
    const frontSlot = this.slots[this.front];
    while (sourceMs >= part.sourceOut - JOIN_EPSILON_MS) {
      const next: PreviewPart | undefined = this.parts[index + 1];
      if (!next?.continuesPrevious) break;
      index += 1;
      part = next;
      frontSlot.partKey = part.key;
      if (frontSlot.el.playbackRate !== part.speed) frontSlot.el.playbackRate = part.speed;
      this.applySound(frontSlot, part);
    }
    this.playingIndex = index;
    // A Fade join hands over where the overlap starts, before the part's own end.
    const handAt = handoverMs(this.parts, part);
    const handSourceMs =
      handAt < part.outEnd ? part.sourceIn + (handAt - part.outStart) * part.speed : part.sourceOut;
    if (sourceMs >= handSourceMs - JOIN_EPSILON_MS) {
      const next = this.parts[index + 1];
      if (next) {
        this.join(next);
      } else {
        this.finish();
      }
      return;
    }
    this.clockMs = outputAt(part, sourceMs);
    if (this.mix && this.clockMs >= this.mix.untilMs - JOIN_EPSILON_MS) {
      this.stopMix(true);
    }
    this.redraw('frame');
    this.publish();
  }

  /** At a join: hand over to the back element if it is ready, or hold the last frame. */
  private join(next: PreviewPart): void {
    // A Fade's mix still holding the back element ends here: the join needs it.
    if (this.mix) this.stopMix(false);
    const problem = this.problemOf(next);
    if (problem) {
      this.holdingFor = null;
      this.clockMs = next.outStart;
      this.reportPartError(next.index, next.sourceId, problem);
      return;
    }
    const back = this.backSlot();
    if (back.partKey === next.key && back.ready) {
      this.handover(next);
      return;
    }
    this.holdingFor = next.key;
    this.clockMs = next.outStart;
    this.stopClock();
    this.slots[this.front].el.pause();
    this.audio.silence();
    this.prepareBack(next.index);
    this.publish();
  }

  /** The back element (ready on `next`) becomes the front one; the old front pauses and waits on the join after. */
  private handover(next: PreviewPart): void {
    const old = this.slots[this.front];
    const outgoing = this.parts[next.index - 1];
    // A Fade (Module 11): the old element plays on through the overlap, mixed in by the stage.
    const fading = next.overlapMs > 0 && outgoing !== undefined && !old.el.paused;
    this.stopMix(false);
    this.stopClock();
    // The old front played on past its seek: it no longer holds any part's start.
    old.partKey = null;
    old.targetMs = null;
    if (!fading) old.ready = false;
    this.front = this.front === 0 ? 1 : 0;
    this.playingIndex = next.index;
    this.holdingFor = null;
    this.clockMs = next.outStart;
    if (fading) {
      this.mix = { slot: old, part: outgoing, untilMs: next.outStart + next.overlapMs };
    }
    this.startFront('handover');
    if (!fading) {
      // A cut (a continuing part plays on in `advance`): no click there.
      this.audio.cutFadeIn?.(this.slots[this.front].el, Math.max(0, next.volume));
      old.el.pause();
    }
    this.redraw('handover');
    this.prepareBack(nextHandover(this.parts, next.index));
    this.publish();
  }

  /**
   * Ends a Fade's mix: the outgoing element pauses, the stage drops its
   * picture, and (when `prepare`) the back element waits on the next join.
   */
  private stopMix(prepare: boolean): void {
    const mix = this.mix;
    if (!mix) return;
    this.mix = null;
    mix.slot.ready = false;
    mix.slot.partKey = null;
    mix.slot.targetMs = null;
    if (!mix.slot.el.paused) mix.slot.el.pause();
    this.stage?.clearMix();
    if (prepare && this.parts.length > 0) {
      this.prepareBack(nextHandover(this.parts, this.playingIndex));
    }
  }

  /** The clip's end: stop with its last frame on screen. */
  private finish(): void {
    this.wantPlaying = false;
    this.stalled = false;
    this.stopClock();
    this.stopMix(false);
    this.slots[this.front].el.pause();
    this.audio.silence();
    this.clockMs = this.durationMs;
    this.inSync = false;
    this.updateLayers('pause');
    this.publish();
  }

  /** After a pause in place: the clock takes the element's exact moment, if it is still inside its part. */
  private settleOnFront(): void {
    const part = this.parts[this.playingIndex];
    if (!part) return;
    const media = this.mediaMsOf(this.slots[this.front]);
    if (media >= part.sourceIn && media < part.sourceOut) {
      this.clockMs = outputAt(part, media);
      this.inSync = true;
    } else {
      this.inSync = false;
    }
    this.updateLayers('pause');
  }

  private scheduleScrubSeek(): void {
    if (this.scrubFrame !== null) return;
    this.scrubFrame = this.frames.request(() => {
      this.scrubFrame = null;
      if (this.destroyed || !this.scrubbing || this.scrubTarget === null) return;
      if (this.slots[this.front].el.seeking) {
        // One seek at a time: the latest moment goes on the next frame.
        this.scheduleScrubSeek();
        return;
      }
      const target = this.scrubTarget;
      this.scrubTarget = null;
      if (this.canSeekVideo()) {
        this.seekFront(target);
      }
    });
  }

  /** Draws `clockMs` from the front element; returns whether a picture was drawn. */
  private redraw(reason: LayerUpdateReason): boolean {
    if (!this.doc || this.parts.length === 0) return false;
    const frontSlot = this.slots[this.front];
    const at = reason === 'seek' ? frontSlot.targetOutputMs : this.clockMs;
    const started = this.measure ? this.now() : 0;
    // Inside a Fade's mix the outgoing part answers until the overlap's middle (`segmentAt`),
    // and it plays on the mix element, not the front one.
    const mix = this.mix;
    const mixPrimary = mix !== null && (partAt(this.parts, at)?.index ?? -1) === mix.part.index;
    const primarySlot = mix && mixPrimary ? mix.slot : frontSlot;
    let state: FrameState;
    try {
      state = frameState(this.doc, at, { sources: this.sourcePictures(primarySlot) });
    } catch {
      this.setError(previewError('draw'));
      return false;
    }
    const join = mix ? state.join : null;
    if (mix && join) {
      // The sounds cross as the pictures do (the export's `acrossfade`).
      const incoming = this.parts[this.playingIndex];
      const fade = state.fadeOpacity;
      this.applyGain(frontSlot, (incoming?.volume ?? 1) * fade * join.progress, at);
      this.applyGain(mix.slot, mix.part.volume * fade * (1 - join.progress), at);
    } else {
      // The video's sound follows the clip's fade frame by frame, as the export's `afade` does.
      this.applyGain(frontSlot, state.videoGain, at);
    }
    let drew = false;
    if (this.stage) {
      try {
        // Until its seek is done the element holds some other moment's
        // frame: lay the areas out, but leave the last picture.
        drew = this.stage.render(
          state,
          primarySlot.el,
          primarySlot === frontSlot ? frontSlot.ready : true,
        );
      } catch {
        // A frame the browser would not hand over (still decoding): the last
        // picture stays, and the next frame tries again.
        drew = false;
      }
      this.drawMix(mix, join, mixPrimary, at);
    }
    this.updateLayersWith(state, reason);
    if (frontSlot.ready) {
      for (const listener of this.pictureListeners) this.tellPicture(listener, frontSlot.el);
    }
    if (drew && reason === 'frame' && this.measure) {
      this.framesDrawn += 1;
      this.drawMsTotal += this.now() - started;
    }
    return drew;
  }

  /**
   * The other side of a Fade over the picture: the incoming part over the
   * outgoing one, at the join's progress (Module 11). Nothing outside a mix.
   */
  private drawMix(
    mix: PreviewEngine['mix'],
    join: FrameState['join'],
    mixPrimary: boolean,
    at: number,
  ): void {
    const stage = this.stage;
    if (!stage) return;
    if (!mix || !join) {
      stage.clearMix();
      return;
    }
    // The side `frameState` did not draw: the incoming one before the middle, else the outgoing one.
    const part = mixPrimary ? this.parts[this.playingIndex] : mix.part;
    const slot = mixPrimary ? this.slots[this.front] : mix.slot;
    if (!part) {
      stage.clearMix();
      return;
    }
    try {
      const side = frameState(this.sideDocOf(part), at - part.outStart, {
        sources: this.sourcePictures(slot),
      });
      stage.renderMix(side, slot.el, mixPrimary ? join.progress : 1 - join.progress);
    } catch {
      stage.clearMix();
    }
  }

  /** The document as just `part`, from its own 0: its picture without the time map's joins. */
  private sideDocOf(part: PreviewPart): ClipDocument {
    const known = this.sideDocs.get(part.id);
    if (known) return known;
    const doc = this.doc as ClipDocument;
    const segment = doc.segments[part.index] as Segment;
    const view: ClipDocument = {
      ...doc,
      segments: [segment],
      joins: [],
      zooms: [],
      tracks: [],
      bleeps: [],
      fades: { inMs: 0, outMs: 0 },
    };
    this.sideDocs.set(part.id, view);
    return view;
  }

  /** The bleeps of `doc` in output ms, to the audio layer too. */
  private setBleeps(doc: ClipDocument): void {
    try {
      this.bleeps = bleepRanges(doc);
    } catch {
      this.bleeps = [];
    }
    try {
      this.audio.setBleeps?.(this.bleeps);
    } catch {
      // A layer's own failure never stops the picture.
    }
  }

  /**
   * Each source's own picture size and frame rate: from the front element
   * when it holds that source's video, else as last seen on either element
   * (0 until then).
   */
  private sourcePictures(slot: Slot): Record<string, SourcePicture> {
    const { el } = slot;
    const map: Record<string, SourcePicture> = {};
    for (const entry of this.doc?.sources ?? []) {
      const { extraId, source } = this.bindingOf(entry.id);
      const url = source?.url ?? null;
      const onFront = extraId === null ? slot.extraId === null : url !== null && slot.url === url;
      const size = onFront
        ? { width: el.videoWidth || 0, height: el.videoHeight || 0 }
        : ((url !== null ? this.pictureSizes.get(url) : undefined) ?? { width: 0, height: 0 });
      map[entry.id] = {
        width: size.width,
        height: size.height,
        fps: source?.fps && source.fps > 0 ? source.fps : 0,
      };
    }
    return map;
  }

  private updateLayers(reason: LayerUpdateReason): void {
    if (!this.doc || this.parts.length === 0) return;
    try {
      this.updateLayersWith(frameState(this.doc, this.clockMs), reason);
    } catch {
      // Reported by the next draw.
    }
  }

  private updateLayersWith(state: FrameState, reason: LayerUpdateReason): void {
    const update = { reason, playing: this.wantPlaying, scrubbing: this.scrubbing };
    try {
      this.overlay.update(state, update);
    } catch {
      // A layer's own failure never stops the picture.
    }
    try {
      if (this.wantPlaying && !this.scrubbing) {
        this.audio.update(state, update);
      }
    } catch {
      // As above.
    }
  }

  /** Stops and reports `error`; `sourceId` names the extra video it is about (null: the main one). */
  private setError(error: PreviewError, sourceId: string | null = null): void {
    this.error = error;
    this.partErrorSource = sourceId;
    this.wantPlaying = false;
    this.stalled = false;
    this.seekPending = false;
    this.holdingFor = null;
    this.stopClock();
    this.stopMix(false);
    this.audio.silence();
    for (const slot of this.slots) {
      if (!slot.el.paused) slot.el.pause();
    }
    this.publish();
  }

  // --------------------------------------------------------------- events

  private onLoadedMetadata(slot: Slot): void {
    if (this.destroyed) return;
    if (slot.url !== null && slot.el.videoWidth > 0 && slot.el.videoHeight > 0) {
      this.pictureSizes.set(slot.url, {
        width: slot.el.videoWidth,
        height: slot.el.videoHeight,
      });
    }
    // A seek asked for before the metadata is made now.
    if (slot.targetMs !== null && !slot.ready) {
      slot.el.currentTime = (slot.targetMs + this.offsetOf(slot)) / 1000;
    }
  }

  private onLoadedData(slot: Slot): void {
    if (this.destroyed || !this.isFront(slot) || !slot.ready) return;
    // The frame arrived after the seek finished: draw it now.
    this.redraw('seek');
    this.ready = true;
    this.publish();
  }

  private onSeeked(slot: Slot): void {
    if (this.destroyed || slot.el.seeking || slot.targetMs === null) return;
    slot.ready = true;
    if (!this.isFront(slot)) {
      // The back element is ready at its part's start: the join it was held
      // at can go on.
      if (this.holdingFor !== null && this.holdingFor === slot.partKey && this.wantPlaying) {
        const next = this.parts.find((part) => part.key === slot.partKey);
        if (next) this.handover(next);
      }
      return;
    }
    this.seekPending = false;
    this.inSync = true;
    this.redraw('seek');
    // Ready once the element holds the frame (`HAVE_CURRENT_DATA`); a frame
    // that arrives later is drawn on `loadeddata`.
    if (slot.el.readyState >= 2) {
      this.ready = true;
    }
    if (this.wantPlaying && !this.scrubbing && this.holdingFor === null) {
      this.clockMs = slot.targetOutputMs;
      this.startFront('seek');
    }
    this.publish();
  }

  private onWaiting(slot: Slot): void {
    if (this.destroyed || !this.isFront(slot) || !this.wantPlaying || this.seekPending) return;
    this.stalled = true;
    this.publish();
  }

  private onPlaying(slot: Slot): void {
    if (this.destroyed || !this.isFront(slot)) return;
    if (this.stalled) {
      this.stalled = false;
      this.publish();
    }
  }

  private onEnded(slot: Slot): void {
    // The file ran out before the part did: treat it as the part's end.
    if (this.destroyed || !this.isFront(slot) || !this.wantPlaying) return;
    const part = this.parts[this.playingIndex];
    if (part) this.advance(part.sourceOut);
  }

  private onError(slot: Slot): void {
    if (this.destroyed) return;
    if (slot.extraId !== null) {
      this.onExtraError(slot, slot.extraId);
      return;
    }
    const error = mediaErrorOf(slot.el.error, this.source, Date.now());
    if (!error) return;
    this.ready = false;
    this.setError(error);
  }

  /**
   * An extra video failed: remembered against its address, and reported now
   * when its part is on screen or being waited for, else when the playhead
   * reaches it.
   */
  private onExtraError(slot: Slot, sourceId: string): void {
    const error = mediaErrorOf(slot.el.error, this.extras[sourceId] ?? null, Date.now());
    if (!error) return;
    // The outgoing side of a Fade failed: the incoming part plays on alone.
    if (this.mix?.slot === slot) this.stopMix(false);
    if (slot.url !== null) this.failures.set(sourceId, { url: slot.url, error });
    const waitedFor = this.holdingFor !== null && this.holdingFor === slot.partKey;
    if (this.isFront(slot) || waitedFor) {
      const part = partAt(this.parts, this.clockMs);
      this.holdingFor = null;
      this.reportPartError(part?.index ?? this.playingIndex, sourceId, error);
      return;
    }
    slot.partKey = null;
    slot.targetMs = null;
    slot.ready = false;
  }

  // ------------------------------------------------------------- snapshot

  private publish(): void {
    if (this.destroyed) return;
    const buffering =
      this.wantPlaying && (this.holdingFor !== null || this.seekPending || this.stalled);
    const stats: PreviewStats | null = this.measure
      ? {
          clock: this.usingFallbackClock ? 'animation-frame' : 'video-frame',
          framesDrawn: this.framesDrawn,
          framesPresented: this.usingFallbackClock ? null : this.framesPresented,
          averageDrawMs:
            this.framesDrawn > 0
              ? Math.round((this.drawMsTotal / this.framesDrawn) * 1000) / 1000
              : 0,
        }
      : null;
    const previous = this.snapshot;
    const next: PreviewSnapshot = {
      currentMs: Math.round(this.clockMs),
      durationMs: this.durationMs,
      playing: this.wantPlaying,
      buffering,
      scrubbing: this.scrubbing,
      ready: this.ready,
      error: sameError(previous.error, this.error) ? previous.error : this.error,
      stats: sameStats(previous.stats, stats) ? previous.stats : stats,
    };
    if (
      next.currentMs === previous.currentMs &&
      next.durationMs === previous.durationMs &&
      next.playing === previous.playing &&
      next.buffering === previous.buffering &&
      next.scrubbing === previous.scrubbing &&
      next.ready === previous.ready &&
      next.error === previous.error &&
      next.stats === previous.stats
    ) {
      return;
    }
    this.snapshot = Object.freeze(next);
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch {
        // One subscriber's failure never stops the others or the clock.
      }
    }
  }
}
