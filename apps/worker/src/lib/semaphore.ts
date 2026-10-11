/**
 * A counting semaphore, for the one thing in the worker that must be rationed.
 *
 * Temporal's `maxConcurrentActivityTaskExecutions` caps *every* activity on the
 * queue at once, so five slow video uploads would also block the quick
 * database reads other posts' timers need. The worker therefore runs many
 * activities and rations only the platform call itself, through this.
 */
export class Semaphore {
  private available: number;
  private readonly waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.available = Math.max(1, permits);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();

    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiting.shift();

    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }
}
