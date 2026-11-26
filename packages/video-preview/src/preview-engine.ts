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
  frameState,
  frameToMs,
  msToFrame,
  outputDuration,
  type SourcePicture,
} from '@postgear/video-engine';
import { isExpired, mediaErrorOf, previewError } from './errors';
import { EmptyOverlayLayer, SilentAudioLayer } from './layers';
import {
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
  private source: PreviewSource | null = null;

  private readonly slots: [Slot, Slot];
  private front: 0 | 1 = 0;
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
    const previous = this.parts[this.playingIndex] ?? null;
    const first = this.doc === null;
    this.doc = doc;
    this.parts = previewParts(doc);
    this.durationMs = outputDuration(doc);
    if (this.clockMs > this.durationMs) {
      this.clockMs = this.durationMs;
    }
    if (this.parts.length === 0) {
      this.stopClock();
      this.publish();
      return;
    }
    if (!this.source || this.error) {
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
      const media = this.mediaMsOf(this.slots[this.front].el);
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
      part.sourceId === previous.sourceId
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
      slot.el.src = url;
    }
    if (this.parts.length > 0) {
      this.seekFront(this.clockMs);
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
    if (this.source && !this.error) {
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
    if (pending !== null && this.source && !this.error) {
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

  private offsetMs(): number {
    return this.source?.offsetMs ?? 0;
  }

  /** The video moment an element shows, in source ms. */
  private mediaMsOf(el: HTMLVideoElement): number {
    return el.currentTime * 1000 - this.offsetMs();
  }

  /** Asks an element to show `sourceMs` of `part`. Before its metadata, the seek waits for it. */
  private placeSlot(slot: Slot, part: PreviewPart, sourceMs: number, outputMs: number): void {
    slot.partKey = part.key;
    slot.targetMs = sourceMs;
    slot.targetOutputMs = outputMs;
    slot.ready = false;
    if (slot.el.readyState >= 1) {
      slot.el.currentTime = (sourceMs + this.offsetMs()) / 1000;
    }
  }

  /** Seeks the front element to the clip moment `outputMs` and readies the back one for the next join. */
  private seekFront(outputMs: number): void {
    const part = partAt(this.parts, outputMs);
    if (!part || !this.source) return;
    this.stopClock();
    const frontSlot = this.slots[this.front];
    if (!frontSlot.el.paused) frontSlot.el.pause();
    this.holdingFor = null;
    this.playingIndex = part.index;
    this.seekPending = true;
    this.inSync = false;
    this.placeSlot(frontSlot, part, seekTargetAt(part, outputMs), outputMs);
    this.prepareBack(nextHandover(this.parts, part.index));
  }

  /** The back element waits on the start of part `index` (or on nothing). */
  private prepareBack(index: number | null): void {
    const back = this.backSlot();
    if (index === null) {
      // No join ahead. Whatever the back element holds stays, so a seek
      // back to an earlier part finds it still ready.
      return;
    }
    const part = this.parts[index] as PreviewPart;
    if (back.partKey === part.key && back.targetMs === part.sourceIn) {
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
  private applyGain(slot: Slot, gain: number): void {
    const safe = Math.max(0, Number.isFinite(gain) ? gain : 0);
    if (this.audio.videoGain?.(slot.el, safe)) {
      if (slot.el.volume !== 1) slot.el.volume = 1;
      return;
    }
    const volume = Math.min(1, safe);
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
    this.advance(metadata.mediaTime * 1000 - this.offsetMs());
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
    this.advance(this.mediaMsOf(this.slots[this.front].el));
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
    if (sourceMs >= part.sourceOut - JOIN_EPSILON_MS) {
      const next = this.parts[index + 1];
      if (next) {
        this.join(next);
      } else {
        this.finish();
      }
      return;
    }
    this.clockMs = outputAt(part, sourceMs);
    this.redraw('frame');
    this.publish();
  }

  /** At a join: hand over to the back element if it is ready, or hold the last frame. */
  private join(next: PreviewPart): void {
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
    this.stopClock();
    // The old front played on past its seek: it no longer holds any part's start.
    old.partKey = null;
    old.targetMs = null;
    old.ready = false;
    this.front = this.front === 0 ? 1 : 0;
    this.playingIndex = next.index;
    this.holdingFor = null;
    this.clockMs = next.outStart;
    this.startFront('handover');
    // A handover is always a cut (a continuing part plays on in `advance`): no click there.
    this.audio.cutFadeIn?.(this.slots[this.front].el, Math.max(0, next.volume));
    old.el.pause();
    this.redraw('handover');
    this.prepareBack(nextHandover(this.parts, next.index));
    this.publish();
  }

  /** The clip's end: stop with its last frame on screen. */
  private finish(): void {
    this.wantPlaying = false;
    this.stalled = false;
    this.stopClock();
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
    const media = this.mediaMsOf(this.slots[this.front].el);
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
      if (this.source && !this.error) {
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
    let state: FrameState;
    try {
      state = frameState(this.doc, at, { sources: this.sourcePictures(frontSlot.el) });
    } catch {
      this.setError(previewError('draw'));
      return false;
    }
    // The video's sound follows the clip's fade frame by frame, as the export's `afade` does.
    this.applyGain(frontSlot, state.videoGain);
    let drew = false;
    if (this.stage) {
      try {
        // Until its seek is done the element holds some other moment's
        // frame: lay the areas out, but leave the last picture.
        drew = this.stage.render(state, frontSlot.el, frontSlot.ready);
      } catch {
        // A frame the browser would not hand over (still decoding): the last
        // picture stays, and the next frame tries again.
        drew = false;
      }
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

  private sourcePictures(el: HTMLVideoElement): Record<string, SourcePicture> {
    const picture: SourcePicture = {
      width: el.videoWidth || 0,
      height: el.videoHeight || 0,
      fps: this.source?.fps && this.source.fps > 0 ? this.source.fps : 0,
    };
    const map: Record<string, SourcePicture> = {};
    for (const entry of this.doc?.sources ?? []) {
      map[entry.id] = picture;
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

  private setError(error: PreviewError): void {
    this.error = error;
    this.wantPlaying = false;
    this.stalled = false;
    this.seekPending = false;
    this.holdingFor = null;
    this.stopClock();
    this.audio.silence();
    for (const slot of this.slots) {
      if (!slot.el.paused) slot.el.pause();
    }
    this.publish();
  }

  // --------------------------------------------------------------- events

  private onLoadedMetadata(slot: Slot): void {
    if (this.destroyed) return;
    // A seek asked for before the metadata is made now.
    if (slot.targetMs !== null && !slot.ready) {
      slot.el.currentTime = (slot.targetMs + this.offsetMs()) / 1000;
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
    const error = mediaErrorOf(slot.el.error, this.source, Date.now());
    if (!error) return;
    this.ready = false;
    this.setError(error);
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
