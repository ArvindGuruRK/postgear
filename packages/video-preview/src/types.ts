/**
 * The shapes the preview engine shares with the editor: what it plays (a
 * signed address), what it reports (one snapshot), and the two slots later
 * modules fill (the overlay layer for text and stickers, the audio layer for
 * sounds).
 */
import type { FrameState } from '@postgear/video-engine';

/** The light copy to play: a signed address that stops working at `expiresAt`. */
export interface PreviewSource {
  url: string;
  /** When the address stops working (ISO text or epoch ms). Unknown when left out. */
  expiresAt?: string | number | null;
  /**
   * The source moment the file's first frame shows, in ms. The light copy
   * holds the whole video from its start, so this is 0 (research 05,
   * section 10); kept as a field so a cut file can be played the same way.
   */
  offsetMs?: number;
  /** The video's frames a second, so crops are read at the frame shown. 0 or missing when unknown. */
  fps?: number | null;
}

/** Why the preview cannot show the clip. Never thrown: it sits on the snapshot. */
export type PreviewErrorCode =
  /** No address was given (the video was deleted, or the clip has none yet). */
  | 'missing_source'
  /** The signed address ran out; fetch a fresh one and call `setSource`. */
  | 'source_expired'
  /** The file stopped downloading (`MEDIA_ERR_NETWORK`). */
  | 'network'
  /** The browser could not decode the file (`MEDIA_ERR_DECODE`). */
  | 'decode'
  /** The address answered something that is not a playable video (`MEDIA_ERR_SRC_NOT_SUPPORTED`). */
  | 'unsupported'
  /** Drawing a moment failed (the document could not be read). */
  | 'draw';

export interface PreviewError {
  code: PreviewErrorCode;
  /** One plain sentence for the person. */
  message: string;
}

/**
 * The cost spike's numbers (Module 08 section 3), kept only when the engine
 * is made with `measure: true`. While playing, every frame the browser shows
 * should be drawn once: `framesDrawn` close to `framesPresented` means the
 * canvas path keeps up; a gap means frames were skipped.
 */
export interface PreviewStats {
  /** Where the clock comes from: the video's own frame callback, or the animation frame fallback. */
  clock: 'video-frame' | 'animation-frame';
  /** Frames drawn onto the area canvases while playing. */
  framesDrawn: number;
  /** Frames the browser presented while playing (from `presentedFrames`); null on the fallback clock. */
  framesPresented: number | null;
  /** The mean time one draw took, in ms (frame state, every area, the layers). */
  averageDrawMs: number;
}

/**
 * Everything the editor reads from the engine. The object only changes
 * identity when one of its fields changes, so it can be handed straight to
 * `useSyncExternalStore`.
 */
export interface PreviewSnapshot {
  /** The playhead, in whole ms of the clip's own time (output time). */
  currentMs: number;
  /** The clip's length in ms. */
  durationMs: number;
  /** Whether playback was asked for (it stays true while buffering). */
  playing: boolean;
  /** Playing, but waiting: the next part is not ready at a join, a seek is running, or the network stalled. */
  buffering: boolean;
  /** Something is being dragged on the timeline: seeks are throttled and the sound is muted. */
  scrubbing: boolean;
  /** The picture at the playhead has been drawn from the current address. */
  ready: boolean;
  error: PreviewError | null;
  /** The cost spike's numbers; null unless the engine measures. */
  stats: PreviewStats | null;
}

/** Why a layer is being updated, so the audio layer knows when to re-align its sounds. */
export type LayerUpdateReason = 'frame' | 'seek' | 'handover' | 'play' | 'pause';

export interface LayerUpdate {
  reason: LayerUpdateReason;
  playing: boolean;
  scrubbing: boolean;
}

/**
 * Text and stickers above the picture (Modules 11 and 12 fill it). Mounted
 * into its own host element over the stage; updated with the same frame
 * state the areas were drawn from.
 */
export interface OverlayLayer {
  mount(host: HTMLElement): void;
  update(state: FrameState, update: LayerUpdate): void;
  destroy(): void;
}

/**
 * Sound effects and music through Web Audio (Module 14 fills it). Updated
 * with each frame state; `reason` other than `frame` means the clock jumped
 * or stopped and every sound should be re-started or stopped.
 */
export interface AudioLayer {
  update(state: FrameState, update: LayerUpdate): void;
  /** Playback stopped (pause, the end, an error, scrubbing). */
  silence(): void;
  destroy(): void;
  /** The engine's two video elements, once, so their sound can join the layer's graph. */
  attachVideos?(elements: readonly HTMLVideoElement[]): void;
  /** Called inside Play's click, the gesture a browser asks for before sound may start. */
  wake?(): void;
  /**
   * The video's own gain this frame (`FrameState.videoGain`, up to 2). True
   * when the layer applied it, and the element's own volume then stays at 1;
   * false and the engine sets the element's volume (at most 1).
   */
  videoGain?(el: HTMLVideoElement, gain: number): boolean;
}

/** The animation frame clock, injectable so tests can step it. */
export interface FrameScheduler {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}
