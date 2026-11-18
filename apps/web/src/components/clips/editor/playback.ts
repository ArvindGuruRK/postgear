'use client';

/**
 * Playback for the clip editor (Module 08 section 4): one small store over
 * the `PreviewEngine`, read through `useSyncExternalStore`.
 *
 * - Components that only need the time (the playhead line, the time text,
 *   the play button) read it here, each through its own selector, so a new
 *   frame re-renders them and nothing else: the editor around them never
 *   re-renders from the clock.
 * - The engine is made in an effect (`usePreviewEngine`), so it arrives
 *   after the first render. The store exists from the start and is
 *   `connect`ed when the engine arrives (and again if StrictMode makes a new
 *   one); before that every reading is the idle one and every command is a
 *   no-op.
 * - The engine already keeps the two guards a timeline needs: a seek moves
 *   the playhead at once (the media clock never pulls it back while a seek
 *   or a drag is running), and `setScrubbing(true)` throttles seeks to one
 *   per animation frame and mutes the sound while something is dragged.
 * - When the document gets shorter than the playhead, the engine moves the
 *   playhead to the new end (`setDocument`), so nothing here has to.
 *
 * No JSX in this file, so the editor can import it anywhere.
 */
import {
  IDLE_PREVIEW_SNAPSHOT,
  type PreviewEngine,
  type PreviewError,
  type PreviewSnapshot,
} from '@postgear/video-preview';
import { useEffect, useState, useSyncExternalStore } from 'react';

/** What the store needs of an engine (the real one, or a stand-in in a test). */
export type PlaybackEngine = Pick<
  PreviewEngine,
  | 'subscribe'
  | 'getSnapshot'
  | 'exactMs'
  | 'play'
  | 'pause'
  | 'toggle'
  | 'seek'
  | 'stepFrames'
  | 'setScrubbing'
>;

export class PlaybackStore {
  private engine: PlaybackEngine | null = null;
  private unsubscribeEngine: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(engine: PlaybackEngine | null = null) {
    this.connect(engine);
  }

  /** Follows this engine from now on (null lets go of the last one). */
  connect(engine: PlaybackEngine | null): void {
    if (engine === this.engine) return;
    this.unsubscribeEngine?.();
    this.unsubscribeEngine = null;
    this.engine = engine;
    if (engine) {
      this.unsubscribeEngine = engine.subscribe(() => this.emit());
    }
    this.emit();
  }

  /** For `useSyncExternalStore`: stable, so React never re-subscribes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The engine's snapshot (the same object until a field changes), or the idle one. */
  getSnapshot = (): PreviewSnapshot => this.engine?.getSnapshot() ?? IDLE_PREVIEW_SNAPSHOT;

  // Readings without subscribing, for event handlers (split at the playhead, a shortcut).

  getCurrentMs(): number {
    return this.getSnapshot().currentMs;
  }

  /** The playhead unrounded, for frame maths. */
  getExactMs(): number {
    return this.engine?.exactMs ?? 0;
  }

  isPlaying(): boolean {
    return this.getSnapshot().playing;
  }

  // Commands.

  play(): void {
    this.engine?.play();
  }

  pause(): void {
    this.engine?.pause();
  }

  toggle(): void {
    this.engine?.toggle();
  }

  /** Moves the playhead to a moment of the clip (clamped into it). */
  seekMs(ms: number): void {
    this.engine?.seek(ms);
  }

  /** Steps whole frames of the clip, back when negative. Pauses first. */
  stepFrames(n: number): void {
    this.engine?.stepFrames(n);
  }

  /** On while the playhead or a bar is dragged on the timeline. */
  setScrubbing(on: boolean): void {
    this.engine?.setScrubbing(on);
  }

  // Hooks: each re-renders its component only when its own value changes.

  useCurrentMs(): number {
    return useSyncExternalStore(this.subscribe, this.readCurrentMs, readZero);
  }

  useDurationMs(): number {
    return useSyncExternalStore(this.subscribe, this.readDurationMs, readZero);
  }

  usePlaying(): boolean {
    return useSyncExternalStore(this.subscribe, this.readPlaying, readFalse);
  }

  useBuffering(): boolean {
    return useSyncExternalStore(this.subscribe, this.readBuffering, readFalse);
  }

  useScrubbing(): boolean {
    return useSyncExternalStore(this.subscribe, this.readScrubbing, readFalse);
  }

  useReady(): boolean {
    return useSyncExternalStore(this.subscribe, this.readReady, readFalse);
  }

  usePreviewError(): PreviewError | null {
    return useSyncExternalStore(this.subscribe, this.readError, readNull);
  }

  /** The whole snapshot: re-renders on every frame while playing, so only for small readouts. */
  useSnapshot(): PreviewSnapshot {
    return useSyncExternalStore(this.subscribe, this.getSnapshot, readIdle);
  }

  private readonly readCurrentMs = () => this.getSnapshot().currentMs;
  private readonly readDurationMs = () => this.getSnapshot().durationMs;
  private readonly readPlaying = () => this.getSnapshot().playing;
  private readonly readBuffering = () => this.getSnapshot().buffering;
  private readonly readScrubbing = () => this.getSnapshot().scrubbing;
  private readonly readReady = () => this.getSnapshot().ready;
  private readonly readError = () => this.getSnapshot().error;

  private emit(): void {
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

// The server render has no engine: the idle readings.
const readZero = () => 0;
const readFalse = () => false;
const readNull = () => null;
const readIdle = () => IDLE_PREVIEW_SNAPSHOT;

/**
 * One `PlaybackStore` for a component's life, following `engine` (the
 * `engine` from `usePreviewEngine`, null until it is made).
 */
export function usePlaybackStore(engine: PlaybackEngine | null): PlaybackStore {
  const [store] = useState(() => new PlaybackStore());
  useEffect(() => {
    store.connect(engine);
  }, [store, engine]);
  useEffect(() => () => store.connect(null), [store]);
  return store;
}
