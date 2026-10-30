/**
 * The builder's autosave (Module 05), modelled on the Studio editor's
 * (`components/studio/editor-autosave.ts`) and, like it, a plain class so
 * its timing is tested without a browser.
 *
 * **Saved means the server has it.** A change waits for a 1 s pause, then
 * goes out as `PATCH /automations/:id { draftRevision, name?, draftGraph? }`
 * with the revision last confirmed. The status is derived, never set:
 *
 * - `pending`: on screen, not sent yet;
 * - `saving`: on its way;
 * - `retrying` / `offline`: failed for a reason that may pass, tried again
 *   on a growing delay, or at once when the browser is back online;
 * - `conflict`: a 409, the workflow changed in another tab. Nothing more is
 *   sent until the person reloads (or copies their changes first);
 * - `failed`: refused in a way sending again unchanged would not fix;
 * - `saved`: nothing waiting, the last save confirmed.
 *
 * One request at a time; a change made during a save goes after it, against
 * the revision that save answered with. Drafts save even with issues:
 * saving never turns a workflow on.
 */
import type { AutomationGraph } from '@postgear/automation';
import { ApiError } from '@/lib/api';
import type { AutomationSaveResult } from '@/types/workflows';

export const SAVE_DELAY_MS = 1_000;
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000];

export type SaveStatus =
  | 'saved'
  | 'pending'
  | 'saving'
  | 'retrying'
  | 'offline'
  | 'conflict'
  | 'failed';

export interface SaveBody {
  draftRevision: number;
  name?: string;
  draftGraph?: AutomationGraph;
}

export interface Version {
  graph: AutomationGraph;
  name: string;
}

export interface BuilderAutosaveDeps {
  send: (body: SaveBody, options: { keepalive: boolean }) => Promise<AutomationSaveResult>;
  onStatus: (status: SaveStatus, message: string | null) => void;
  onSaved?: (result: AutomationSaveResult) => void;
  isOnline?: () => boolean;
  delay?: number;
  retryDelays?: readonly number[];
}

type Timer = ReturnType<typeof setTimeout>;

function retryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

function refusal(error: ApiError): string {
  if (error.status === 401) return 'Your session has ended. Sign in again to keep editing.';
  if (error.status === 404) return 'This workflow was deleted, so your changes cannot be saved.';
  return error.message;
}

export class BuilderAutosave {
  private saved: Version;
  private screen: Version;
  private revision: number;
  private timer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private inFlight = false;
  private sendAfter = false;
  private attempt = 0;
  private offline = false;
  private halt: { kind: 'conflict' } | { kind: 'failed'; message: string } | null = null;
  private disposed = false;
  private state: SaveStatus = 'saved';
  private waiters: ((saved: boolean) => void)[] = [];
  /** Bumped by `reset`: an answer to a request sent before it is stale. */
  private generation = 0;

  constructor(
    saved: Version & { revision: number },
    private readonly deps: BuilderAutosaveDeps,
  ) {
    this.saved = { graph: saved.graph, name: saved.name };
    this.screen = { ...this.saved };
    this.revision = saved.revision;
  }

  get status(): SaveStatus {
    return this.state;
  }

  get currentRevision(): number {
    return this.revision;
  }

  /** Anything on screen the server has not confirmed (and still could). */
  get unsaved(): boolean {
    return this.dirty() || this.inFlight;
  }

  /** What the builder shows, after every change. */
  update(screen: Version): void {
    if (this.disposed) return;
    if (screen.graph === this.screen.graph && screen.name === this.screen.name) return;
    this.screen = screen;
    if (this.halt) return;

    if (!this.dirty()) {
      this.clearTimer();
      if (!this.inFlight) {
        this.clearRetry();
        this.attempt = 0;
        this.offline = false;
      }
    } else if (this.attempt === 0) {
      this.schedule();
    }
    this.emit();
    if (this.state === 'saved') this.settle(true);
  }

  /** Saves now. Resolves true once the server has everything on screen. */
  flush(): Promise<boolean> {
    if (this.disposed || this.halt) return Promise.resolve(false);
    if (!this.unsaved) return Promise.resolve(true);
    const done = new Promise<boolean>((resolve) => this.waiters.push(resolve));
    this.clearTimer();
    this.clearRetry();
    this.sendNow(false);
    return done;
  }

  /** The browser is back online: a waiting save goes now. */
  online(): void {
    if (this.disposed || this.halt || this.attempt === 0) return;
    this.clearRetry();
    this.sendNow(false);
  }

  /** Try Again after a refusal. */
  retry(): void {
    if (this.disposed || this.halt?.kind !== 'failed') return;
    this.halt = null;
    this.attempt = 0;
    this.sendNow(false);
    this.emit();
  }

  /** The tab is being hidden or closed: what is unsaved goes now, on a request that outlives the page. */
  keepalive(): void {
    if (this.disposed || this.halt || this.inFlight || !this.dirty()) return;
    this.clearTimer();
    this.clearRetry();
    this.sendNow(true);
  }

  /**
   * The server's draft changed under the builder on purpose (activate,
   * discard, restore a version): it is now both saved and on screen, at its
   * new revision. Anything waiting is dropped, an answer still on its way
   * is ignored, and a conflict or refusal is cleared.
   */
  reset(saved: Version & { revision: number }): void {
    if (this.disposed) return;
    this.generation += 1;
    this.clearTimer();
    this.clearRetry();
    this.saved = { graph: saved.graph, name: saved.name };
    this.screen = { ...this.saved };
    this.revision = saved.revision;
    this.inFlight = false;
    this.sendAfter = false;
    this.attempt = 0;
    this.offline = false;
    this.halt = null;
    this.emit();
    this.settle(true);
  }

  /** The editor is closing: whatever is unsaved goes on a request that outlives the page. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.clearRetry();
    this.settle(false);
    if (!this.halt && !this.inFlight && this.dirty()) this.sendNow(true);
  }

  // -------------------------------------------------------------------------

  private dirty(): boolean {
    return this.screen.graph !== this.saved.graph || this.screen.name !== this.saved.name;
  }

  private body(): SaveBody | null {
    const body: SaveBody = { draftRevision: this.revision };
    if (this.screen.name !== this.saved.name) body.name = this.screen.name;
    if (this.screen.graph !== this.saved.graph) body.draftGraph = this.screen.graph;
    return body.name === undefined && body.draftGraph === undefined ? null : body;
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
    const sent = { ...this.screen };
    const generation = this.generation;
    this.inFlight = true;
    this.sendAfter = false;
    this.emit();
    this.deps.send(body, { keepalive }).then(
      (result) => {
        if (generation === this.generation) this.succeeded(sent, result);
      },
      (error: unknown) => {
        if (generation === this.generation) this.failed(error);
      },
    );
  }

  private succeeded(sent: Version, result: AutomationSaveResult): void {
    this.inFlight = false;
    this.saved = sent;
    this.revision = result.draftRevision;
    this.attempt = 0;
    this.offline = false;
    if (!this.disposed) this.deps.onSaved?.(result);

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

  private failed(error: unknown): void {
    this.inFlight = false;
    this.sendAfter = false;
    if (error instanceof ApiError && error.status === 409) {
      this.halt = { kind: 'conflict' };
      this.clearTimer();
    } else if (!retryable(error)) {
      this.halt = { kind: 'failed', message: refusal(error as ApiError) };
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

  private derive(): SaveStatus {
    if (this.halt) return this.halt.kind;
    if (this.attempt > 0) return this.offline ? 'offline' : 'retrying';
    if (this.inFlight) return 'saving';
    if (this.dirty()) return 'pending';
    return 'saved';
  }

  private emit(): void {
    const state = this.derive();
    if (state === this.state && state !== 'failed') return;
    this.state = state;
    if (!this.disposed) {
      this.deps.onStatus(state, this.halt?.kind === 'failed' ? this.halt.message : null);
    }
  }

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
