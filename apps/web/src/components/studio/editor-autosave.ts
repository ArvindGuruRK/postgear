/**
 * The editor's autosave (DS-6.1 to DS-6.4), as a plain class so its timing can
 * be tested without a browser.
 *
 * It owns one rule above all: **Saved means the server has it.** A change
 * waits for a pause in editing (`SAVE_DELAY_MS`), then goes out with the
 * revision the editor last saw. The status is derived, never set by hand:
 *
 * - `pending`: something on screen has not been sent yet;
 * - `saving`: a save is on its way;
 * - `retrying` / `offline`: a save failed for a reason that may pass (no
 *   connection, a busy or broken server), and is tried again on a growing
 *   delay, or as soon as the browser says it is back online;
 * - `conflict`: the server has a newer revision (another tab, a teammate).
 *   Nothing more is sent until the person chooses Reload or to keep theirs;
 * - `failed`: the server refused the save in a way trying again unchanged
 *   would not fix. The refusal says why and what is left to do
 *   (`SaveRefusal`): try again, sign in again, or go back to Studio for a
 *   design that is gone;
 * - `saved`: nothing is waiting and the server confirmed the last save.
 *
 * Every save is one request at a time. Title and document travel together
 * when both changed, so a rename and an edit can never race each other into
 * a self-inflicted conflict, and a change made while a save is in flight is
 * sent after it, against the revision that save answered with.
 *
 * Leaving the editor sends whatever is still unsaved on a `keepalive`
 * request, which outlives the page, while its body fits the browser's cap
 * for one (`keepaliveFits`).
 */
import type { DesignDocument } from '@postgear/design-engine';
import { ApiError } from '@/lib/api';
import type { DesignSaveResult } from '@/types/studio';
import type { SaveState } from './studio-view-model';

/** DS-6.1: about 1.5 seconds after the last change. */
export const SAVE_DELAY_MS = 1_500;

/** How long each retry waits; the last repeats. */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000];

/** What `PATCH /studio/designs/:id` takes. */
export interface SaveBody {
  revision: number;
  title?: string;
  document?: DesignDocument;
  lastSlideIndex?: number;
}

/** What the server has. */
export interface SavedVersion {
  document: DesignDocument;
  title: string;
  revision: number;
}

/** What the editor shows. */
export interface ScreenVersion {
  document: DesignDocument;
  title: string;
  /** Where the editor is, saved with the next document save so a reopen lands there. */
  slideIndex: number;
}

/**
 * What is left to do after a refusal: send it again (`retry`), sign in again
 * (`signIn`, the session ended), or leave (`gone`, the design is not there
 * any more, so no try can succeed).
 */
export type RefusalKind = 'retry' | 'signIn' | 'gone';

/** A refused save: why, in words a person can act on, and what is left to do. */
export interface SaveRefusal {
  kind: RefusalKind;
  message: string;
}

export interface AutosaveDeps {
  send: (body: SaveBody, options: { keepalive: boolean }) => Promise<DesignSaveResult>;
  /** The status changed, with the server's refusal when it is `failed`. */
  onStatus: (status: SaveState, refusal: SaveRefusal | null) => void;
  /** The server confirmed a save. */
  onSaved: (result: DesignSaveResult) => void;
  /** Whether the browser thinks it has a connection. */
  isOnline?: () => boolean;
  delay?: number;
  retryDelays?: readonly number[];
}

type Halt = { kind: 'conflict' } | { kind: 'failed'; refusal: SaveRefusal } | null;

type Timer = ReturnType<typeof setTimeout>;

/** A failure that may pass on its own: no connection, or a busy or broken server. */
function retryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

/** What a refused save says, and what is left to do about it. */
export function refusalOf(error: ApiError): SaveRefusal {
  switch (error.status) {
    case 400:
      return { kind: 'retry', message: 'This change could not be saved. Undo it, then try again.' };
    case 401:
      return {
        kind: 'signIn',
        message:
          'Your session has ended, so your changes cannot be saved. Sign in again to keep editing this design.',
      };
    case 404:
      return { kind: 'gone', message: 'This design was deleted, so your changes cannot be saved.' };
    default:
      return { kind: 'retry', message: error.message };
  }
}

/**
 * Browsers refuse a `keepalive` request whose body is over 64 KB, at once and
 * whatever is in it; this stays a little under that.
 */
export const KEEPALIVE_MAX_BYTES = 60_000;

/** How many bytes `text` takes in UTF-8, the encoding a request body is sent in. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Whether a save may go as a `keepalive` request: only while its JSON body
 * fits the browser's cap for one. A bigger one goes as an ordinary request,
 * which still completes after a move within the app (the page keeps
 * running); only closing the tab can cut it off.
 */
export function keepaliveFits(body: SaveBody): boolean {
  return utf8Length(JSON.stringify(body)) <= KEEPALIVE_MAX_BYTES;
}

/**
 * A save made against the design's own workspace. The API scopes every
 * request on the active-workspace cookie and answers 404 alike for a design
 * that is gone and for one in another workspace, so a switch made in another
 * tab would read here as a deletion. A save answered 404 therefore points
 * the cookie back at this design's workspace (`resync`, as
 * `SyncActiveWorkspace` does) and goes once more: only a second 404 means
 * the design is gone. A failed `resync` is the save's failure.
 *
 * Never for a `keepalive` save: the person is leaving, maybe for the other
 * workspace on purpose, and the cookie stays as they set it.
 */
export async function saveInWorkspace<T>(
  save: () => Promise<T>,
  resync: () => Promise<unknown>,
  keepalive: boolean,
): Promise<T> {
  try {
    return await save();
  } catch (error) {
    if (keepalive || !(error instanceof ApiError) || error.status !== 404) throw error;
  }

  await resync();
  return save();
}

export class Autosave {
  private saved: SavedVersion;
  private screen: ScreenVersion;
  private timer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private inFlight = false;
  /** The pause ended, or `flush` asked, while a save was in flight. */
  private sendAfter = false;
  private attempt = 0;
  private offline = false;
  private halt: Halt = null;
  /** Bumped by `replace`: an answer to a save sent before it is ignored. */
  private generation = 0;
  private disposed = false;
  private state: SaveState = 'saved';
  private refusal: SaveRefusal | null = null;
  private waiters: ((saved: boolean) => void)[] = [];

  constructor(
    saved: SavedVersion,
    slideIndex: number,
    private readonly deps: AutosaveDeps,
  ) {
    this.saved = saved;
    this.screen = { document: saved.document, title: saved.title, slideIndex };
  }

  get status(): SaveState {
    return this.state;
  }

  /** The revision the next save is sent against. */
  get revision(): number {
    return this.saved.revision;
  }

  /**
   * True while anything on screen is not confirmed by the server and still
   * could be: a design that was deleted has nothing left to save, so leaving
   * it never asks.
   */
  get unsaved(): boolean {
    if (this.halt?.kind === 'failed' && this.halt.refusal.kind === 'gone') return false;
    return this.dirty() || this.inFlight;
  }

  /** Called with what the editor shows, after every change. */
  update(screen: ScreenVersion): void {
    if (this.disposed) return;

    const changed = screen.document !== this.screen.document || screen.title !== this.screen.title;
    this.screen = screen;
    // Moving between slides is not worth a save of its own: the index rides
    // along with the next document save.
    if (!changed || this.halt) return;

    if (!this.dirty()) {
      this.clearTimer();
      if (!this.inFlight) {
        // Back to what the server has (an undo): nothing is waiting any more.
        this.clearRetry();
        this.attempt = 0;
        this.offline = false;
      }
    } else if (this.attempt === 0) {
      // A failing save retries on its own clock and takes the latest with it.
      this.schedule();
    }

    this.emit();
    if (this.state === 'saved') this.settle(true);
  }

  /**
   * Saves now rather than after the pause. Resolves true once the server has
   * everything on screen, false when that cannot happen yet (no connection,
   * a conflict, a refusal).
   */
  flush(): Promise<boolean> {
    if (this.disposed || this.halt) return Promise.resolve(false);
    if (!this.unsaved) return Promise.resolve(true);

    const done = new Promise<boolean>((resolve) => this.waiters.push(resolve));
    this.clearTimer();
    this.clearRetry();
    this.sendNow(false);
    return done;
  }

  /** Try Again, after a save the server refused (the island offers it for `retry` refusals). */
  retry(): void {
    if (this.disposed || this.halt?.kind !== 'failed') return;

    this.halt = null;
    this.attempt = 0;
    this.offline = false;
    this.sendNow(false);
    this.emit();
  }

  /** The browser says the connection is back: a waiting save goes now. */
  online(): void {
    if (this.disposed || this.halt || this.attempt === 0) return;

    this.clearRetry();
    this.sendNow(false);
  }

  /**
   * A new starting point after a conflict: what the server has now, and what
   * the editor will show. Reload passes the server's version as both; keeping
   * the version on screen passes it as `screen`, which then saves over the
   * server's at its new revision.
   */
  replace(saved: SavedVersion, screen: ScreenVersion): void {
    if (this.disposed) return;

    this.generation += 1;
    this.clearTimer();
    this.clearRetry();
    this.inFlight = false;
    this.sendAfter = false;
    this.attempt = 0;
    this.offline = false;
    this.halt = null;
    this.saved = saved;
    this.screen = screen;
    this.settle(false);

    if (this.dirty()) this.sendNow(false);
    this.emit();
  }

  /** The page is being hidden (a tab closing): send what is waiting, on a request that outlives it. */
  keepalive(): void {
    if (this.disposed || this.halt) return;

    if (this.inFlight) {
      // The save in flight may be cut off with the page; this copy of it,
      // with anything typed since, is not. Should both arrive, the second is
      // refused as a conflict and the first has already saved.
      const body = this.body();
      if (body) this.deps.send(body, { keepalive: true }).catch(() => undefined);
      return;
    }

    if (!this.dirty()) return;

    this.clearTimer();
    this.clearRetry();
    this.sendNow(true);
  }

  /** The editor is closing: whatever is unsaved goes out on a request that outlives it. */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.clearTimer();
    this.clearRetry();
    this.settle(false);

    // A save in flight sends the rest when it answers (see `succeeded`).
    if (!this.halt && !this.inFlight && this.dirty()) this.sendNow(true);
  }

  // -------------------------------------------------------------------------

  private dirty(): boolean {
    return this.screen.document !== this.saved.document || this.screen.title !== this.saved.title;
  }

  private body(): SaveBody | null {
    const body: SaveBody = { revision: this.saved.revision };

    if (this.screen.title !== this.saved.title) body.title = this.screen.title;

    if (this.screen.document !== this.saved.document) {
      const last = this.screen.document.slides.length - 1;
      body.document = this.screen.document;
      body.lastSlideIndex = Math.max(0, Math.min(this.screen.slideIndex, last));
    }

    return body.title === undefined && body.document === undefined ? null : body;
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sendNow(false);
    }, this.deps.delay ?? SAVE_DELAY_MS);
  }

  private sendNow(keepalive: boolean): void {
    if (this.inFlight) {
      this.sendAfter = true;
      return;
    }
    if (this.halt) return;

    const body = this.body();
    if (!body) {
      this.attempt = 0;
      this.offline = false;
      this.emit();
      if (this.state === 'saved') this.settle(true);
      return;
    }

    const sent = { document: this.screen.document, title: this.screen.title };
    const generation = this.generation;
    this.inFlight = true;
    this.sendAfter = false;
    this.emit();

    this.deps.send(body, { keepalive }).then(
      (result) => this.succeeded(generation, sent, result),
      (error: unknown) => this.failed(generation, error),
    );
  }

  private succeeded(
    generation: number,
    sent: { document: DesignDocument; title: string },
    result: DesignSaveResult,
  ): void {
    if (generation !== this.generation) return;

    this.inFlight = false;
    this.saved = { document: sent.document, title: sent.title, revision: result.revision };
    this.attempt = 0;
    this.offline = false;
    if (!this.disposed) this.deps.onSaved(result);

    if (this.dirty()) {
      if (this.disposed) {
        this.sendNow(true);
        return;
      }
      if (this.sendAfter || this.waiters.length > 0) this.sendNow(false);
      else if (!this.timer) this.schedule();
    }

    this.emit();
    if (this.state === 'saved') this.settle(true);
  }

  private failed(generation: number, error: unknown): void {
    if (generation !== this.generation) return;

    this.inFlight = false;
    this.sendAfter = false;

    if (error instanceof ApiError && error.status === 409) {
      this.halt = { kind: 'conflict' };
      this.clearTimer();
    } else if (!retryable(error)) {
      this.halt = { kind: 'failed', refusal: refusalOf(error as ApiError) };
      this.clearTimer();
    } else if (!this.disposed) {
      this.offline = this.deps.isOnline ? !this.deps.isOnline() : false;
      const delays = this.deps.retryDelays ?? RETRY_DELAYS_MS;
      const wait = delays[Math.min(this.attempt, delays.length - 1)] ?? SAVE_DELAY_MS;
      this.attempt += 1;
      this.clearTimer();
      this.clearRetry();
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.sendNow(false);
      }, wait);
    }

    this.emit();
    this.settle(false);
  }

  private derive(): SaveState {
    if (this.halt) return this.halt.kind;
    if (this.attempt > 0) return this.offline ? 'offline' : 'retrying';
    if (this.inFlight) return 'saving';
    if (this.dirty()) return 'pending';
    return 'saved';
  }

  private emit(): void {
    const state = this.derive();
    const refusal = this.halt?.kind === 'failed' ? this.halt.refusal : null;
    if (state === this.state && refusal === this.refusal) return;

    this.state = state;
    this.refusal = refusal;
    if (!this.disposed) this.deps.onStatus(state, refusal);
  }

  /** Answers everyone waiting on `flush`. */
  private settle(saved: boolean): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(saved);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
