/**
 * The concurrency gate: how many analyses may run at once, and one per
 * workspace.
 *
 * A crawl holds a browser page, a socket and up to thirty seconds of wall
 * time, and the trigger is a text box anyone with an account can type into.
 * Two limits, for two reasons:
 *
 * - **A process-wide cap** (`SEO_MAX_CONCURRENT_AUDITS`), so a burst of
 *   analyses degrades to "try again in a moment" rather than to an API that
 *   has exhausted its memory on headless browsers.
 * - **One per workspace**, so no single workspace can take every slot, and
 *   so a person double-clicking "Analyze" gets one run rather than two
 *   charged twice.
 *
 * `tryAcquire` never waits. A queued analysis would hold a request open
 * doing nothing for up to a minute, and the UI can retry a 429 far more
 * gracefully than it can explain a stream that has not started. In-process
 * state is the right scope: the limit protects *this* process's resources,
 * and a second replica has its own.
 */
export type Release = () => void;

export class SeoGate {
  private active = 0;
  private readonly workspaces = new Set<string>();

  constructor(readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error(`SeoGate: maxConcurrent must be a positive integer, got ${maxConcurrent}`);
    }
  }

  /** Analyses running right now. */
  get running(): number {
    return this.active;
  }

  /** True while this workspace has an analysis running. */
  isBusy(orgId: string): boolean {
    return this.workspaces.has(orgId);
  }

  /**
   * Takes a slot for `orgId`, or returns null when none is free (globally or
   * for this workspace). The release is idempotent, so a `finally` that runs
   * after an explicit release does no harm.
   */
  tryAcquire(orgId: string): Release | null {
    if (this.workspaces.has(orgId) || this.active >= this.maxConcurrent) {
      return null;
    }

    this.workspaces.add(orgId);
    this.active += 1;
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active -= 1;
      this.workspaces.delete(orgId);
    };
  }
}
