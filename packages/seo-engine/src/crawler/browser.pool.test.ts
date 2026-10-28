/**
 * The pool's own bookkeeping, with Playwright replaced by a fake: slots are
 * never lost to a cancelled wait, and a cancelled render lets go of its page
 * at once instead of when its timeouts run out. The real-Chromium paths are
 * in `crawler.browser.test.ts` and `render.browser.test.ts` (opt-in).
 */
import { createBrowserPool } from './browser.pool';

interface FakeContext {
  closed: boolean;
  route: jest.Mock;
  newPage: jest.Mock;
  close: jest.Mock;
}

const contexts: FakeContext[] = [];

/** The readiness expression the render options below wait on. */
const READY = 'window.__pgFitDone === true';

/**
 * What a fake page answers when the render asks whether it is ready: never
 * (a page stuck in a script of its own), or these answers in turn, the last
 * one repeating.
 */
let readiness: 'hang' | boolean[] = [true];

function fakeContext(): FakeContext {
  let rejectPending: ((error: Error) => void) | null = null;

  const context: FakeContext = {
    closed: false,
    route: jest.fn(async () => undefined),
    // No `waitForFunction` on purpose: it polls inside the page, where an
    // export page's CSP refuses its eval, so the render must never use it.
    newPage: jest.fn(async () => {
      const answers = readiness === 'hang' ? 'hang' : [...readiness];
      return {
        setDefaultTimeout: jest.fn(),
        setContent: jest.fn(async () => undefined),
        evaluate: jest.fn((expression: string) => {
          if (expression !== READY) return Promise.resolve(['headline']);
          if (answers === 'hang') {
            return new Promise((_, reject) => {
              rejectPending = reject;
            });
          }
          return Promise.resolve(answers.length > 1 ? answers.shift() : answers[0]);
        }),
        screenshot: jest.fn(async () => Buffer.from('png')),
      };
    }),
    close: jest.fn(async () => {
      context.closed = true;
      rejectPending?.(new Error('Target page, context or browser has been closed'));
    }),
  };

  contexts.push(context);
  return context;
}

jest.mock('playwright', () => ({
  chromium: {
    launch: async () => ({
      on: () => undefined,
      isConnected: () => true,
      close: async () => undefined,
      newContext: async () => fakeContext(),
    }),
  },
}));

/** Resolves to 'timeout' if the promise has not settled within `ms`. */
function within<T>(promise: Promise<T>, ms = 200): Promise<T | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms)),
  ]);
}

beforeEach(() => {
  contexts.length = 0;
  readiness = [true];
});

describe('the pool slots', () => {
  it('gives a slot back when a queued wait is cancelled', async () => {
    const pool = createBrowserPool({ maxPages: 1 });
    const first = await pool.acquire();

    const controller = new AbortController();
    const queued = pool.acquire({ signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });

    await first.release();

    // With the cancelled waiter still queued, this would wait forever.
    const next = await within(pool.acquire());
    expect(next).not.toBe('timeout');
    if (next !== 'timeout') await next.release();
    await pool.close();
  });

  it('refuses at once when the signal is already aborted', async () => {
    const pool = createBrowserPool({ maxPages: 1 });
    const controller = new AbortController();
    controller.abort();

    await expect(pool.acquire({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await pool.close();
  });
});

describe('render', () => {
  const options = {
    html: '<!doctype html><p>Slide</p>',
    width: 1080,
    height: 1080,
    type: 'png' as const,
    waitForFunction: READY,
    collect: 'window.__pgOverflow',
  };

  /** The fake page a context handed out. */
  async function pageOf(context: FakeContext): Promise<{ evaluate: jest.Mock }> {
    return context.newPage.mock.results[0]?.value as Promise<{ evaluate: jest.Mock }>;
  }

  function readinessAsks(page: { evaluate: jest.Mock }): number {
    return page.evaluate.mock.calls.filter(([expression]) => expression === READY).length;
  }

  it('keeps asking from outside the page until the page is ready', async () => {
    readiness = [false, false, true];
    const pool = createBrowserPool({ maxPages: 1 });
    const result = await pool.render(options);

    expect(result.value).toEqual(['headline']);
    expect(readinessAsks(await pageOf(contexts[0]))).toBe(3);
    await pool.close();
  });

  it('gives up when the page never becomes ready, and closes its page', async () => {
    readiness = [false];
    const pool = createBrowserPool({ maxPages: 1 });

    await expect(pool.render({ ...options, timeoutMs: 100 })).rejects.toMatchObject({
      name: 'TimeoutError',
      message: expect.stringMatching(/Timeout 100ms exceeded/),
    });
    expect(contexts[0].closed).toBe(true);
    await pool.close();
  });

  it('gives up on a page that never answers, rather than waiting on it forever', async () => {
    readiness = 'hang';
    const pool = createBrowserPool({ maxPages: 1 });

    await expect(within(pool.render({ ...options, timeoutMs: 100 }), 1_000)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    expect(contexts[0].closed).toBe(true);

    readiness = [true];
    const next = await within(pool.render(options));
    expect(next).not.toBe('timeout');
    await pool.close();
  });

  it('returns the image and the collected value, and closes its page', async () => {
    const pool = createBrowserPool({ maxPages: 1 });
    const result = await pool.render(options);

    expect(result.image.toString()).toBe('png');
    expect(result.value).toEqual(['headline']);
    expect(contexts[0].closed).toBe(true);
    await pool.close();
  });

  it('blocks every request the page makes', async () => {
    const pool = createBrowserPool({ maxPages: 1 });
    await pool.render(options);

    const [pattern, handler] = contexts[0].route.mock.calls[0] as [
      string,
      (route: { abort: jest.Mock }) => void,
    ];
    const route = { abort: jest.fn(async () => undefined) };
    handler(route);

    expect(pattern).toBe('**/*');
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    await pool.close();
  });

  it('stops at once when cancelled mid-wait, and frees its slot', async () => {
    readiness = 'hang';
    const pool = createBrowserPool({ maxPages: 1 });
    const controller = new AbortController();

    const rendering = pool.render({ ...options, signal: controller.signal, timeoutMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(within(rendering)).rejects.toMatchObject({ name: 'AbortError' });
    expect(contexts[0].closed).toBe(true);

    readiness = [true];
    const next = await within(pool.render(options));
    expect(next).not.toBe('timeout');
    await pool.close();
  });
});
