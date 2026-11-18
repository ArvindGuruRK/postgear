/**
 * More Video (Module 09 section 3): asks the API for the sharp stretch a
 * trim reached past, without ever flooding it.
 *
 * - **Debounced**: a range is sent `debounceMs` after the last ask, so an
 *   undo straight after a trim, or several quick trims, send one request.
 * - **One at a time, the latest wins**: an ask while a request is out waits
 *   for it, and only the newest range is sent after it.
 * - **The same range once**: a range already answered is not sent again
 *   (the API would answer the same job).
 * - **The per-clip limit** (429 `more_video_throttled`, one start every 10
 *   seconds): the range is kept and sent again after `throttleMs`.
 * - **A dropped connection or a server error** is tried again after
 *   `retryMs`, up to `maxTries` times for one range; then it is dropped and
 *   `onFailed` says so. Any other refusal (the video went, the range is not
 *   allowed) is dropped at once.
 *
 * Plain class with injected timers, so the rules are tested with Jest's
 * fake clock.
 */
import type { SourceRange } from '@postgear/video-engine';
import { ApiError } from '@/lib/api';
import type { ClipJobView, ClipSharpState } from '@/types/clips';

export interface MoreVideoAnswer {
  job: ClipJobView | null;
  sharp: ClipSharpState;
}

export interface MoreVideoOptions {
  send: (range: SourceRange) => Promise<MoreVideoAnswer>;
  onAnswer: (answer: MoreVideoAnswer, range: SourceRange) => void;
  /** Whether something is waiting or out, for the dock's "Getting more of the video". */
  onPending?: (pending: boolean) => void;
  /** A range given up on (refused, or the connection never came back). */
  onFailed?: (range: SourceRange, cause: unknown) => void;
  debounceMs?: number;
  throttleMs?: number;
  retryMs?: number;
  maxTries?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export const MORE_VIDEO_DEBOUNCE_MS = 600;
/** The API starts one job per clip every 10 seconds; a little over that. */
export const MORE_VIDEO_THROTTLE_MS = 10_500;
export const MORE_VIDEO_RETRY_MS = 4_000;
export const MORE_VIDEO_MAX_TRIES = 3;

const sameRange = (a: SourceRange | null, b: SourceRange | null) =>
  a !== null && b !== null && a.fromMs === b.fromMs && a.toMs === b.toMs;

/** Whether a failed request is worth sending again: no answer at all, or the server's own fault. */
function worthRetrying(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return true;
  return cause.status === 0 || cause.status >= 500;
}

export class MoreVideoRequester {
  private readonly options: Required<
    Pick<MoreVideoOptions, 'debounceMs' | 'throttleMs' | 'retryMs' | 'maxTries'>
  > &
    MoreVideoOptions;
  private wanted: SourceRange | null = null;
  private answered: SourceRange | null = null;
  private sending = false;
  private timer: unknown = null;
  private tries = 0;
  private disposed = false;
  private lastPending = false;

  constructor(options: MoreVideoOptions) {
    this.options = {
      debounceMs: MORE_VIDEO_DEBOUNCE_MS,
      throttleMs: MORE_VIDEO_THROTTLE_MS,
      retryMs: MORE_VIDEO_RETRY_MS,
      maxTries: MORE_VIDEO_MAX_TRIES,
      ...options,
    };
  }

  /** Something is waiting to be sent or is out. */
  get pending(): boolean {
    return this.sending || this.wanted !== null;
  }

  /** Asks for `range`; the newest ask replaces any that has not been sent yet. */
  request(range: SourceRange): void {
    if (this.disposed) return;
    if (sameRange(range, this.answered)) {
      // Already answered: the job it started covers it, or it is held.
      if (!this.sending) this.cancelTimer();
      this.wanted = null;
      this.emit();
      return;
    }
    if (!sameRange(range, this.wanted)) this.tries = 0;
    this.wanted = range;
    if (!this.sending) this.schedule(this.options.debounceMs);
    this.emit();
  }

  /** Forgets what was answered, so the same range may be asked again (after a reload). */
  forget(): void {
    this.answered = null;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.wanted = null;
  }

  private schedule(ms: number) {
    this.cancelTimer();
    const set = this.options.setTimer ?? ((run, wait) => setTimeout(run, wait));
    this.timer = set(() => {
      this.timer = null;
      void this.fire();
    }, ms);
  }

  private cancelTimer() {
    if (this.timer === null) return;
    const clear =
      this.options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    clear(this.timer);
    this.timer = null;
  }

  private emit() {
    const pending = this.pending;
    if (pending === this.lastPending) return;
    this.lastPending = pending;
    this.options.onPending?.(pending);
  }

  private async fire(): Promise<void> {
    if (this.disposed || this.sending || !this.wanted) return;
    const range = this.wanted;
    this.sending = true;
    this.tries += 1;
    let next: number | null = null;
    try {
      const answer = await this.options.send(range);
      if (this.disposed) return;
      this.answered = range;
      if (sameRange(this.wanted, this.answered)) this.wanted = null;
      this.tries = 0;
      this.options.onAnswer(answer, range);
    } catch (cause) {
      if (this.disposed) return;
      if (cause instanceof ApiError && cause.status === 429) {
        // The limit is not this range's fault: keep the try count.
        this.tries -= 1;
        next = this.options.throttleMs;
      } else if (worthRetrying(cause) && this.tries < this.options.maxTries) {
        next = this.options.retryMs;
      } else {
        if (sameRange(this.wanted, range)) this.wanted = null;
        this.tries = 0;
        this.options.onFailed?.(range, cause);
      }
    } finally {
      this.sending = false;
    }
    if (this.disposed) return;
    if (this.wanted) this.schedule(next ?? this.options.debounceMs);
    this.emit();
  }
}
