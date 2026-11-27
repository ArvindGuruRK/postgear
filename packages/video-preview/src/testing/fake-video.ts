/**
 * A `<video>` for tests. jsdom has no media at all (no loading, no seeking,
 * no playing, no frame callbacks), so this is a real jsdom `<video>` element
 * (it can sit in the DOM like the real one) whose media behaviour is played
 * by the test, one step at a time:
 *
 * - `loadMetadata()` gives it a size and fires `loadedmetadata` and `loadeddata`.
 * - Setting `currentTime` starts a seek (`seeking` true); `finishSeek()` ends it
 *   with `seeked`, as the browser does after decoding.
 * - `play()` and `pause()` flip `paused` and fire `play`, `playing`, `pause`.
 * - `presentFrame(mediaMs)` moves the media clock and calls the frame
 *   callbacks with `mediaTime` and `presentedFrames`, as
 *   `requestVideoFrameCallback` does; `advanceTo(mediaMs)` moves it without
 *   callbacks (for the animation frame fallback).
 * - `fail(code)` sets a `MediaError` and fires `error`.
 * - With `loadOnSrc`, setting `src` starts loading as a browser does: the
 *   element forgets its metadata (a seek then waits for `loadMetadata()`),
 *   any error is cleared, and `v0:src <address>` goes into the log.
 *
 * Every call that matters to a test goes into a shared `log` (`v0:play`,
 * `v1:seek 40000`), so a test can check the order of a hand-over.
 */

export interface FakeVideoOptions {
  /** Whether it has `requestVideoFrameCallback` (Firefox before 132 does not). */
  frameCallback?: boolean;
  /** Setting `src` resets the element and is logged (off by default: the older tests do not expect it). */
  loadOnSrc?: boolean;
}

type FrameCallback = (
  now: number,
  metadata: { mediaTime: number; presentedFrames: number },
) => void;

export class FakeVideo {
  readonly el: HTMLVideoElement;
  readonly name: string;
  private time = 0;
  private isSeeking = false;
  private isPaused = true;
  private state = 0;
  private width = 0;
  private height = 0;
  private mediaError: { code: number; message: string } | null = null;
  private presented = 0;
  private nextHandle = 1;
  private readonly callbacks = new Map<number, FrameCallback>();
  /** Event listeners currently attached, by type (to check `destroy`). */
  readonly listenerCounts = new Map<string, number>();
  playbackRateValue = 1;

  constructor(
    name: string,
    private readonly log: string[],
    options: FakeVideoOptions = {},
  ) {
    this.name = name;
    const el = document.createElement('video');
    this.el = el;
    const define = (key: string, descriptor: PropertyDescriptor) =>
      Object.defineProperty(el, key, { configurable: true, ...descriptor });

    define('currentTime', {
      get: () => this.time,
      set: (value: number) => {
        this.time = value;
        this.isSeeking = true;
        this.log.push(`${name}:seek ${Math.round(value * 1000)}`);
        el.dispatchEvent(new Event('seeking'));
      },
    });
    define('seeking', { get: () => this.isSeeking });
    define('paused', { get: () => this.isPaused });
    define('readyState', { get: () => this.state });
    define('videoWidth', { get: () => this.width });
    define('videoHeight', { get: () => this.height });
    define('error', { get: () => this.mediaError });
    define('duration', { get: () => 600 });
    define('playbackRate', {
      get: () => this.playbackRateValue,
      set: (value: number) => {
        if (value !== this.playbackRateValue) this.log.push(`${name}:rate ${value}`);
        this.playbackRateValue = value;
      },
    });
    define('preservesPitch', { value: true, writable: true });
    define('muted', { value: false, writable: true });
    define('volume', { value: 1, writable: true });
    define('play', {
      value: () => {
        this.isPaused = false;
        this.log.push(`${name}:play`);
        el.dispatchEvent(new Event('play'));
        el.dispatchEvent(new Event('playing'));
        return Promise.resolve();
      },
    });
    define('pause', {
      value: () => {
        if (this.isPaused) return;
        this.isPaused = true;
        this.log.push(`${name}:pause`);
        el.dispatchEvent(new Event('pause'));
      },
    });
    define('load', {
      value: () => {
        this.state = 0;
        this.isSeeking = false;
      },
    });
    if (options.loadOnSrc === true) {
      define('src', {
        get: () => el.getAttribute('src') ?? '',
        set: (value: string) => {
          el.setAttribute('src', value);
          this.state = 0;
          this.isSeeking = false;
          this.mediaError = null;
          this.width = 0;
          this.height = 0;
          this.log.push(`${name}:src ${value}`);
        },
      });
    }
    if (options.frameCallback !== false) {
      define('requestVideoFrameCallback', {
        value: (callback: FrameCallback) => {
          const handle = this.nextHandle++;
          this.callbacks.set(handle, callback);
          return handle;
        },
      });
      define('cancelVideoFrameCallback', {
        value: (handle: number) => {
          this.callbacks.delete(handle);
        },
      });
    }
    const add = el.addEventListener.bind(el);
    const remove = el.removeEventListener.bind(el);
    define('addEventListener', {
      value: (type: string, listener: EventListenerOrEventListenerObject, opts?: unknown) => {
        this.listenerCounts.set(type, (this.listenerCounts.get(type) ?? 0) + 1);
        add(type, listener, opts as AddEventListenerOptions);
      },
    });
    define('removeEventListener', {
      value: (type: string, listener: EventListenerOrEventListenerObject, opts?: unknown) => {
        this.listenerCounts.set(type, Math.max(0, (this.listenerCounts.get(type) ?? 0) - 1));
        remove(type, listener, opts as EventListenerOptions);
      },
    });
  }

  /** The media clock, in ms. */
  get mediaMs(): number {
    return this.time * 1000;
  }

  get isPlaying(): boolean {
    return !this.isPaused;
  }

  get isSeekingNow(): boolean {
    return this.isSeeking;
  }

  /** Frame callbacks waiting to be called. */
  get pendingFrameCallbacks(): number {
    return this.callbacks.size;
  }

  get totalListeners(): number {
    let total = 0;
    for (const count of this.listenerCounts.values()) total += count;
    return total;
  }

  /** The file's facts arrived: `loadedmetadata`, then the first frame (`loadeddata`). */
  loadMetadata(width = 1280, height = 720): void {
    this.width = width;
    this.height = height;
    this.state = 1;
    this.el.dispatchEvent(new Event('loadedmetadata'));
    this.state = 4;
    this.el.dispatchEvent(new Event('loadeddata'));
  }

  /** The seek in flight is done: `seeked`. Does nothing when no seek runs. */
  finishSeek(): boolean {
    if (!this.isSeeking) return false;
    this.isSeeking = false;
    this.log.push(`${this.name}:seeked ${Math.round(this.time * 1000)}`);
    this.el.dispatchEvent(new Event('seeked'));
    return true;
  }

  /** The browser presents the frame at `mediaMs`: the clock moves and the frame callbacks run. */
  presentFrame(mediaMs: number, skipped = 0): void {
    this.time = mediaMs / 1000;
    this.presented += 1 + skipped;
    const waiting = Array.from(this.callbacks.entries());
    this.callbacks.clear();
    for (const [, callback] of waiting) {
      callback(0, { mediaTime: mediaMs / 1000, presentedFrames: this.presented });
    }
  }

  /** Moves the media clock without any callback (the fallback clock reads `currentTime`). */
  advanceTo(mediaMs: number): void {
    this.time = mediaMs / 1000;
  }

  /** The network stalled. */
  stall(): void {
    this.el.dispatchEvent(new Event('waiting'));
  }

  fail(code: 1 | 2 | 3 | 4, message = 'failed'): void {
    this.mediaError = { code, message };
    this.el.dispatchEvent(new Event('error'));
  }
}

/** Makes fake videos for an engine (`createVideo`), all writing into one log. */
export function fakeVideoFactory(options: FakeVideoOptions = {}): {
  create: () => HTMLVideoElement;
  videos: FakeVideo[];
  log: string[];
} {
  const log: string[] = [];
  const videos: FakeVideo[] = [];
  return {
    log,
    videos,
    create: () => {
      const video = new FakeVideo(`v${videos.length}`, log, options);
      videos.push(video);
      return video.el;
    },
  };
}

/** An animation frame clock the test steps by hand. */
export class FakeFrames {
  private nextHandle = 1;
  private readonly waiting = new Map<number, (now: number) => void>();
  requests = 0;

  request = (callback: (now: number) => void): number => {
    const handle = this.nextHandle++;
    this.waiting.set(handle, callback);
    this.requests += 1;
    return handle;
  };

  cancel = (handle: number): void => {
    this.waiting.delete(handle);
  };

  get pending(): number {
    return this.waiting.size;
  }

  /** Runs the callbacks waiting now (not the ones they ask for). */
  flush(now = 0): void {
    const batch = Array.from(this.waiting.values());
    this.waiting.clear();
    for (const callback of batch) callback(now);
  }
}
