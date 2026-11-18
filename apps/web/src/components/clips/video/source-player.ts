'use client';

/**
 * The video page's player (Module 07, section 3): a plain native `<video>`
 * on the light copy's signed address, wrapped in a tiny store.
 *
 * - The clock is read from the element on every animation frame while it
 *   plays, and on seeks and pauses otherwise. Only what subscribes (the
 *   playhead, the time text) draws again; the page does not re-render 60
 *   times a second.
 * - `playRange` plays one part and stops at its end (a clip's Play button).
 * - A new address for the same file (the old one is about to expire) keeps
 *   the position and whether it was playing.
 *
 * Every method is safe to call before the element exists or after it left.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

export interface SourcePlayerSnapshot {
  currentMs: number;
  durationMs: number;
  playing: boolean;
  ready: boolean;
  /** The element could not play the file (an address that stopped working, a decode error). */
  failed: boolean;
}

const INITIAL: SourcePlayerSnapshot = {
  currentMs: 0,
  durationMs: 0,
  playing: false,
  ready: false,
  failed: false,
};

export class SourcePlayerStore {
  private element: HTMLVideoElement | null = null;
  private snapshot: SourcePlayerSnapshot;
  private readonly listeners = new Set<() => void>();
  private frame: number | null = null;
  private stopAtMs: number | null = null;
  private resume: { atMs: number; playing: boolean } | null = null;
  private detachEvents: (() => void) | null = null;

  constructor(durationMs = 0) {
    this.snapshot = { ...INITIAL, durationMs };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SourcePlayerSnapshot => this.snapshot;

  getCurrentMs = (): number => this.snapshot.currentMs;

  private set(next: Partial<SourcePlayerSnapshot>) {
    const merged = { ...this.snapshot, ...next };
    if (
      merged.currentMs === this.snapshot.currentMs &&
      merged.durationMs === this.snapshot.durationMs &&
      merged.playing === this.snapshot.playing &&
      merged.ready === this.snapshot.ready &&
      merged.failed === this.snapshot.failed
    ) {
      return;
    }
    this.snapshot = merged;
    for (const listener of this.listeners) listener();
  }

  /** Called by the `<video>`'s ref. */
  attach = (element: HTMLVideoElement | null) => {
    if (element === this.element) return;
    this.detachEvents?.();
    this.detachEvents = null;
    this.stopClock();
    this.element = element;
    if (!element) return;

    const read = () => Math.round((element.currentTime || 0) * 1000);
    const onMeta = () => {
      const duration = Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : 0;
      if (this.resume) {
        const { atMs, playing } = this.resume;
        this.resume = null;
        element.currentTime = atMs / 1000;
        if (playing) void element.play().catch(() => this.set({ playing: false }));
      }
      this.set({ ready: true, failed: false, durationMs: duration || this.snapshot.durationMs });
    };
    const onPlay = () => {
      this.set({ playing: true });
      this.startClock();
    };
    const onPause = () => {
      this.stopClock();
      this.set({ playing: false, currentMs: read() });
    };
    const onSeeked = () => this.set({ currentMs: read() });
    const onEnded = () => {
      this.stopClock();
      this.set({ playing: false, currentMs: read() });
    };
    const onError = () => {
      this.stopClock();
      this.set({ failed: true, playing: false });
    };
    element.addEventListener('loadedmetadata', onMeta);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('seeked', onSeeked);
    element.addEventListener('ended', onEnded);
    element.addEventListener('error', onError);
    this.detachEvents = () => {
      element.removeEventListener('loadedmetadata', onMeta);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('seeked', onSeeked);
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('error', onError);
    };
    if (element.readyState >= 1) onMeta();
  };

  private startClock() {
    if (this.frame !== null || typeof requestAnimationFrame === 'undefined') return;
    const tick = () => {
      const element = this.element;
      if (!element) {
        this.frame = null;
        return;
      }
      const at = Math.round(element.currentTime * 1000);
      if (this.stopAtMs !== null && at >= this.stopAtMs) {
        const stop = this.stopAtMs;
        this.stopAtMs = null;
        element.pause();
        element.currentTime = stop / 1000;
        this.set({ currentMs: stop });
        this.frame = null;
        return;
      }
      this.set({ currentMs: at });
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopClock() {
    if (this.frame !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.frame);
    }
    this.frame = null;
  }

  /** Before the address changes: where to carry on once the new one loads. */
  holdPosition() {
    const element = this.element;
    if (!element || !this.snapshot.ready) return;
    this.resume = { atMs: Math.round(element.currentTime * 1000), playing: !element.paused };
  }

  /**
   * Where the player opens (the clip the editor came back from): a seek now
   * when the video is ready, else kept until it is.
   */
  startAt(ms: number) {
    const at = Math.max(0, Math.round(ms));
    if (this.element && this.snapshot.ready) {
      this.seek(at);
      return;
    }
    this.resume = { atMs: at, playing: false };
    this.set({ currentMs: at });
  }

  play = () => {
    this.stopAtMs = null;
    const element = this.element;
    if (!element) return;
    if (element.ended || this.snapshot.currentMs >= this.snapshot.durationMs - 50) {
      element.currentTime = 0;
    }
    void element.play().catch(() => this.set({ playing: false }));
  };

  pause = () => {
    this.stopAtMs = null;
    this.element?.pause();
  };

  toggle = () => {
    if (this.snapshot.playing) this.pause();
    else this.play();
  };

  seek = (ms: number) => {
    const duration = this.snapshot.durationMs;
    const at = Math.max(0, Math.min(duration > 0 ? duration : ms, Math.round(ms)));
    this.stopAtMs = null;
    this.set({ currentMs: at });
    if (this.element) this.element.currentTime = at / 1000;
  };

  /** Plays `fromMs` to `toMs`, then stops at its end. */
  playRange = (fromMs: number, toMs: number) => {
    const element = this.element;
    if (!element || !(toMs > fromMs)) return;
    this.seek(fromMs);
    this.stopAtMs = Math.round(toMs);
    void element.play().catch(() => this.set({ playing: false }));
  };

  /**
   * Stops the clock and lets go of the element. Subscribers leave on their
   * own, and the next ref call attaches again (React's dev double mount).
   */
  destroy() {
    this.stopClock();
    this.detachEvents?.();
    this.detachEvents = null;
    this.element = null;
  }
}

/** One store per page; destroyed when the page leaves. */
export function useSourcePlayer(durationMs: number): SourcePlayerStore {
  const store = useMemo(() => new SourcePlayerStore(durationMs), [durationMs]);
  useEffect(() => () => store.destroy(), [store]);
  return store;
}

export function usePlayerSnapshot(store: SourcePlayerStore): SourcePlayerSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function usePlayerCurrentMs(store: SourcePlayerStore): number {
  return useSyncExternalStore(store.subscribe, store.getCurrentMs, store.getCurrentMs);
}

/**
 * Keeps the signed address fresh: asks for a new one a few minutes before
 * `expiresAt` and hands it over without losing the place.
 */
export function useFreshAddress(
  store: SourcePlayerStore,
  expiresAt: string | null,
  refresh: () => void,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const hold = useCallback(() => store.holdPosition(), [store]);
  useEffect(() => {
    if (!expiresAt) return;
    const at = Date.parse(expiresAt);
    if (Number.isNaN(at)) return;
    // Five minutes early, and never sooner than ten seconds from now.
    const wait = Math.max(10_000, at - Date.now() - 5 * 60_000);
    const timer = window.setTimeout(() => refreshRef.current(), Math.min(wait, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  return hold;
}
