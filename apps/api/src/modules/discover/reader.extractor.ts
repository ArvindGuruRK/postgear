/**
 * Finding the article in a page, somewhere it can be stopped (Module 08).
 *
 * `extractArticle` is synchronous work on a stranger's markup, and no set of
 * limits on a page's shape bounds it: a review of this module found three
 * shapes the engine's limits did not see, one of them a 160 KB page that took
 * 17 seconds. On the thread that serves requests, that is 17 seconds of nobody
 * being answered, health checks included.
 *
 * So it never runs there. It runs in one worker thread that this file owns, a
 * page at a time, and a page that has not come back in two seconds is not
 * waited for: the worker is killed, the page is answered "could not read", and
 * a new worker starts for the next one. The engine's limits stay in front as a
 * cheap first filter, so nearly every hostile page is refused in milliseconds
 * and the kill is the exception.
 *
 * ## How the worker finds the engine
 *
 * The engine exports its own file's path (`EXTRACT_ARTICLE_FILE`). In a build
 * that is compiled JavaScript and is simply required. Under ts-node-dev and
 * Jest it is the TypeScript source, so the worker registers ts-node for itself
 * first (transpile only, with options of its own, reading no tsconfig). The
 * worker's code is a string in this file so that it exists in every one of
 * those worlds without a second file to ship.
 *
 * ## What comes back
 *
 * Always an outcome, never a throw, with the time the page really took, so the
 * service can charge that to the workspace that asked. The worker also has a
 * memory ceiling: a page that tries to exhaust it only ends its own worker.
 */
import { Worker } from 'node:worker_threads';
import { type Article, EXTRACT_ARTICLE_FILE } from '@postgear/discover-engine';

export const ARTICLE_EXTRACTOR = Symbol('ARTICLE_EXTRACTOR');

/** A page that has not come back by now is given up on, and its worker with it. */
export const EXTRACT_DEADLINE_MS = 2_000;
/** Pages waiting for the one worker. More than this and a read is told to try again. */
export const EXTRACT_MAX_WAITING = 8;
/** ts-node has to load a compiler the first time, in development. */
const STARTUP_DEADLINE_MS = 30_000;
const WORKER_MEMORY_MB = 256;

export type ExtractOutcome =
  /** `ms` is how long the page took the worker, queueing not included. */
  | { outcome: 'article'; article: Article; ms: number }
  | { outcome: 'not_article'; ms: number }
  /** The engine's limits refused it, or it ran out of time and the worker was killed. */
  | { outcome: 'too_complex'; ms: number }
  /** The worker could not be started, or stopped on its own. Says nothing about the page. */
  | { outcome: 'failed'; ms: number }
  /** Too many pages were already waiting. Nothing was parsed. */
  | { outcome: 'busy' };

export interface ArticleExtractor {
  extract(html: string, url: string): Promise<ExtractOutcome>;
}

interface WorkerReply {
  id?: number;
  ready?: boolean;
  article?: Article | null;
  refused?: 'too_complex' | 'threw';
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
if (workerData.file.endsWith('.ts')) {
  require('ts-node').register({
    transpileOnly: true,
    skipProject: true,
    compilerOptions: { module: 'commonjs', target: 'es2022', esModuleInterop: true },
  });
}
const { extractArticle, PageTooComplexError } = require(workerData.file);
parentPort.on('message', (job) => {
  try {
    parentPort.postMessage({ id: job.id, article: extractArticle(job.html, job.url) });
  } catch (error) {
    const refused = error instanceof PageTooComplexError ? 'too_complex' : 'threw';
    parentPort.postMessage({ id: job.id, refused });
  }
});
parentPort.postMessage({ ready: true });
`;

export class WorkerArticleExtractor implements ArticleExtractor {
  private worker: Worker | null = null;
  private starting: Promise<Worker> | null = null;
  /** The pages in order: each waits for the one before it. */
  private line: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private nextId = 1;

  constructor(private readonly deadlineMs: number = EXTRACT_DEADLINE_MS) {}

  async extract(html: string, url: string): Promise<ExtractOutcome> {
    if (this.waiting >= EXTRACT_MAX_WAITING) return { outcome: 'busy' };

    this.waiting += 1;
    const turn = this.line.then(() => this.run(html, url));
    this.line = turn.catch(() => undefined);
    try {
      return await turn;
    } catch {
      return { outcome: 'failed', ms: 0 };
    } finally {
      this.waiting -= 1;
    }
  }

  /**
   * Starts the worker ahead of the first page. Under ts-node it has a compiler to
   * load, which takes a few seconds nobody should wait for behind "Reading the
   * page...". A failure here is not reported: the first page will try again.
   */
  warm(): void {
    void this.start().catch(() => undefined);
  }

  /** Stops the worker. For shutdown, and for a spec that must not leave a thread behind. */
  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.starting = null;
    await worker?.terminate();
  }

  private async run(html: string, url: string): Promise<ExtractOutcome> {
    const worker = await this.start();
    const started = Date.now();
    const id = this.nextId;
    this.nextId += 1;

    return new Promise<ExtractOutcome>((resolve) => {
      const took = () => Date.now() - started;
      const finish = (outcome: ExtractOutcome) => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('exit', onGone);
        worker.off('error', onGone);
        resolve(outcome);
      };
      const onMessage = (reply: WorkerReply) => {
        if (reply.id !== id) return;
        if (reply.refused === 'too_complex') finish({ outcome: 'too_complex', ms: took() });
        else if (reply.refused) finish({ outcome: 'failed', ms: took() });
        else if (reply.article) finish({ outcome: 'article', article: reply.article, ms: took() });
        else finish({ outcome: 'not_article', ms: took() });
      };
      // Out of memory, or a crash in a library: the page was more than it could take.
      const onGone = () => {
        this.forget(worker);
        finish({ outcome: 'too_complex', ms: took() });
      };
      const timer = setTimeout(() => {
        // Nothing can interrupt it from inside, so the whole thread goes.
        this.forget(worker);
        void worker.terminate();
        finish({ outcome: 'too_complex', ms: this.deadlineMs });
      }, this.deadlineMs);

      worker.on('message', onMessage);
      worker.once('exit', onGone);
      worker.once('error', onGone);
      worker.postMessage({ id, html, url });
    });
  }

  private forget(worker: Worker): void {
    if (this.worker === worker) {
      this.worker = null;
      this.starting = null;
    }
  }

  /** The worker, started on the first page and after every kill. */
  private start(): Promise<Worker> {
    if (this.worker) return Promise.resolve(this.worker);
    if (this.starting) return this.starting;

    this.starting = new Promise<Worker>((resolve, reject) => {
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { file: EXTRACT_ARTICLE_FILE },
        resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_MB },
      });
      // It must never be what keeps the process, or a test run, alive.
      worker.unref();

      const fail = () => {
        clearTimeout(timer);
        this.starting = null;
        void worker.terminate();
        reject(new Error('The article worker did not start.'));
      };
      const timer = setTimeout(fail, STARTUP_DEADLINE_MS);
      timer.unref();
      worker.once('error', fail);
      worker.once('exit', fail);
      worker.once('message', (reply: WorkerReply) => {
        clearTimeout(timer);
        worker.off('error', fail);
        worker.off('exit', fail);
        if (!reply.ready) {
          fail();
          return;
        }
        this.worker = worker;
        resolve(worker);
      });
    });

    return this.starting;
  }
}
