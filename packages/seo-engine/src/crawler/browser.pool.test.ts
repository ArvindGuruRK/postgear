/**
 * The pool's own bookkeeping, with Playwright replaced by a fake: slots are
 * never lost to a cancelled wait, and a cancelled render lets go of its page
 * at once instead of when its timeouts run out. The real-Chromium paths are
 * in `crawler.browser.test.ts` and `render.browser.test.ts` (opt-in).
 */
import { createBrowserPool } from './browser.pool';

interface FakeContext {
  closed: boolean;
  /** What the pool asked `newContext` for. */
  options: Record<string, unknown>;
  route: jest.Mock;
  newPage: jest.Mock;
  close: jest.Mock;
}

interface FakePage {
  setContent: jest.Mock;
  evaluate: jest.Mock;
  screenshot: jest.Mock;
  pdf: jest.Mock;
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

/** Whether a picture handed to a print page decodes, or never finishes. */
let pictures: 'decode' | 'hang' = 'decode';

function fakeContext(options: Record<string, unknown> = {}): FakeContext {
  let rejectPending: ((error: Error) => void) | null = null;
  const hang = () =>
    new Promise((_, reject) => {
      rejectPending = reject;
    });

  const context: FakeContext = {
    closed: false,
    options,
    route: jest.fn(async () => undefined),
    // No `waitForFunction` on purpose: it polls inside the page, where an
    // export page's CSP refuses its eval, so the render must never use it.
    newPage: jest.fn(async () => {
      const answers = readiness === 'hang' ? 'hang' : [...readiness];
      return {
        setDefaultTimeout: jest.fn(),
        setContent: jest.fn(async () => undefined),
        // A function is a print page's `addPicture`; a string is the render's
        // readiness check or its `collect` expression.
        evaluate: jest.fn((expression: unknown) => {
          if (typeof expression === 'function') {
            return pictures === 'hang' ? hang() : Promise.resolve(undefined);
          }
          if (expression !== READY) return Promise.resolve(['headline']);
          if (answers === 'hang') return hang();
          return Promise.resolve(answers.length > 1 ? answers.shift() : answers[0]);
        }),
        screenshot: jest.fn(async () => Buffer.from('png')),
        pdf: jest.fn(async () => Buffer.from('%PDF-1.4')),
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
      newContext: async (options: Record<string, unknown>) => fakeContext(options),
    }),
  },
}));

/** The fake page a context handed out. */
async function pageOf(context: FakeContext): Promise<FakePage> {
  return context.newPage.mock.results[0]?.value as Promise<FakePage>;
}

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
  pictures = 'decode';
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

  it('lays a 2x page out at its CSS size and shoots it in device pixels', async () => {
    const pool = createBrowserPool({ maxPages: 1 });
    await pool.render({ ...options, scale: 2 });
    await pool.render(options);

    expect(contexts[0].options).toMatchObject({
      viewport: { width: 1080, height: 1080 },
      deviceScaleFactor: 2,
      offline: true,
    });
    expect(contexts[1].options).toMatchObject({ deviceScaleFactor: 1 });
    expect((await pageOf(contexts[0])).screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ clip: { x: 0, y: 0, width: 1080, height: 1080 }, scale: 'device' }),
    );
    await pool.close();
  });
});

describe('printImages', () => {
  const png = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' };
  const jpeg = { bytes: Buffer.from([4, 5, 6]), mimeType: 'image/jpeg' };
  const size = { width: 1080, height: 1350 };

  /** The `data:` URIs the print handed its page, in order. */
  function picturesGiven(page: FakePage): unknown[] {
    return page.evaluate.mock.calls
      .filter(([expression]) => typeof expression === 'function')
      .map(([, source]) => source);
  }

  it('prints each picture on a page of its own, in the offline context, and closes it', async () => {
    const pool = createBrowserPool({ maxPages: 1 });
    const pdf = await pool.printImages({ images: [png, jpeg], ...size });

    expect(pdf.toString()).toBe('%PDF-1.4');

    const [context] = contexts;
    expect(context.options).toMatchObject({
      viewport: size,
      deviceScaleFactor: 1,
      offline: true,
      serviceWorkers: 'block',
    });
    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function));

    const page = await pageOf(context);
    const [frame] = page.setContent.mock.calls[0] as [string];
    // 1350px (1012.5 points) is not a length Chromium prints whole: the
    // paper and the pictures both go up to the nearest 8px, 1352px.
    expect(frame).toContain('@page { size: 1080px 1352px; margin: 0; }');
    expect(frame).toContain('width: 1080px; height: 1352px; object-fit: fill;');
    expect(frame).toContain("default-src 'none'; img-src data:");
    expect(picturesGiven(page)).toEqual([
      'data:image/png;base64,AQID',
      'data:image/jpeg;base64,BAUG',
    ]);
    expect(page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        width: '1080px',
        height: '1352px',
        printBackground: true,
        preferCSSPageSize: true,
      }),
    );
    expect(context.closed).toBe(true);
    await pool.close();
  });

  it('reads the pictures one at a time, each handed over before the next is read', async () => {
    const pool = createBrowserPool({ maxPages: 1 });
    const order: string[] = [];

    async function* slides() {
      for (const [index, image] of [png, jpeg].entries()) {
        order.push(`read ${index + 1}`);
        yield image;
        const page = await pageOf(contexts[0]);
        order.push(`given ${picturesGiven(page).length}`);
      }
    }

    await pool.printImages({ images: slides(), ...size });

    expect(order).toEqual(['read 1', 'given 1', 'read 2', 'given 2']);
    await pool.close();
  });

  it('refuses a file that is not a picture, and a set with nothing in it, keeping no slot', async () => {
    const pool = createBrowserPool({ maxPages: 1 });

    await expect(
      pool.printImages({
        images: [{ bytes: new Uint8Array([60]), mimeType: 'text/html' }],
        ...size,
      }),
    ).rejects.toThrow('cannot be printed');
    await expect(pool.printImages({ images: [], ...size })).rejects.toThrow('nothing to print');
    expect(contexts.every((context) => context.closed)).toBe(true);

    const next = await within(pool.printImages({ images: [png], ...size }));
    expect(next).not.toBe('timeout');
    await pool.close();
  });

  it('gives up when the print takes too long, and frees its slot', async () => {
    pictures = 'hang';
    const pool = createBrowserPool({ maxPages: 1 });

    await expect(
      within(pool.printImages({ images: [png], ...size, timeoutMs: 100 }), 1_000),
    ).rejects.toMatchObject({
      name: 'TimeoutError',
      message: expect.stringMatching(/Timeout 100ms exceeded waiting for the print/),
    });
    expect(contexts[0].closed).toBe(true);

    pictures = 'decode';
    const next = await within(pool.printImages({ images: [png], ...size }));
    expect(next).not.toBe('timeout');
    await pool.close();
  });

  it('stops at once when cancelled, and says it was cancelled', async () => {
    pictures = 'hang';
    const pool = createBrowserPool({ maxPages: 1 });
    const controller = new AbortController();

    const printing = pool.printImages({ images: [png], ...size, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(within(printing)).rejects.toMatchObject({ name: 'AbortError' });
    expect(contexts[0].closed).toBe(true);
    await pool.close();
  });
});
