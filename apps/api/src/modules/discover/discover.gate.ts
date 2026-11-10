/**
 * How many outside fetches may run at once in this process.
 *
 * Modelled on `SeoGate`, with one difference that comes from who is waiting. An
 * analysis is a minute of work that a person chose to start, so that gate refuses
 * straight away and the UI retries. Here a slot frees up within seconds and someone
 * is looking at an empty page, so a short wait is much the better answer. The wait
 * is bounded, so a stuck upstream cannot pile up requests behind it.
 *
 * In-process is the right scope: it protects this process's sockets, and being
 * refused says nothing about the source, so it never counts towards a breaker.
 */
export type Release = () => void;

export class DiscoverGate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    readonly maxConcurrent: number,
    private readonly maxWaitMs: number,
  ) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error(
        `DiscoverGate: maxConcurrent must be a positive integer, got ${maxConcurrent}`,
      );
    }
  }

  /** Fetches running right now. */
  get running(): number {
    return this.active;
  }

  /**
   * A slot, as soon as one is free, or null if none came free in time. First come,
   * first served. The release is idempotent, so a `finally` cannot hand a slot back
   * twice.
   */
  acquire(): Promise<Release | null> {
    if (this.active < this.maxConcurrent) return Promise.resolve(this.take());

    return new Promise((resolve) => {
      const turn = () => {
        clearTimeout(timer);
        resolve(this.take());
      };
      const timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(turn), 1);
        resolve(null);
      }, this.maxWaitMs);
      this.waiting.push(turn);
    });
  }

  private take(): Release {
    this.active += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}
