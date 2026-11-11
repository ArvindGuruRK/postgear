/**
 * The article worker for real: a thread that finds articles, and that is killed
 * when a page takes too long, while this thread goes on answering.
 *
 * Real timers and a real worker. Its first page pays for loading a compiler
 * (the worker reads the engine's TypeScript source here), so the first test is
 * slow and the rest are not.
 */
import {
  createReaderFixtureFetch,
  MAX_ELEMENT_ATTRIBUTES,
  MAX_PAGE_DEPTH,
  READER_SAMPLE,
} from '@postgear/discover-engine';
import {
  EXTRACT_DEADLINE_MS,
  EXTRACT_MAX_WAITING,
  type ExtractOutcome,
  WorkerArticleExtractor,
} from './reader.extractor';

jest.setTimeout(120_000);

const INIT = { accept: 'text/html', signal: new AbortController().signal, maxBytes: 1024 * 1024 };
const URL = 'https://news.example/story';

function page(body: string): string {
  return `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`;
}

function chains(count: number, depth: number): string {
  return `${'<div>'.repeat(depth)}<p>some words in a paragraph</p>${'</div>'.repeat(depth)}`.repeat(
    count,
  );
}

/**
 * A page that passes every limit of the engine and still takes the article
 * finder a second or two: many short chains of nested boxes.
 */
const SLOW_PAGE = page(chains(230, 20));

async function sample(url: string): Promise<string> {
  return (await createReaderFixtureFetch()(url, INIT)).body;
}

describe('WorkerArticleExtractor', () => {
  let extractor: WorkerArticleExtractor;

  beforeAll(() => {
    extractor = new WorkerArticleExtractor();
  });

  afterAll(async () => {
    await extractor.close();
  });

  it('finds the article in a page, in its worker, and says how long it took', async () => {
    const html = await sample(READER_SAMPLE.article);

    const result = await extractor.extract(html, READER_SAMPLE.article);

    expect(result.outcome).toBe('article');
    if (result.outcome !== 'article') return;
    expect(result.article).toMatchObject({
      title: 'Harbour market reopens after two years of repairs',
      siteName: 'The Sample Courier',
      byline: 'A. Reporter',
      language: 'en-GB',
    });
    expect(result.article.text).toContain('The old harbour market opened its gates again');
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(result.ms).toBeLessThan(EXTRACT_DEADLINE_MS);
  });

  it('carries Tamil text across the thread as it was written', async () => {
    const result = await extractor.extract(
      await sample(READER_SAMPLE.tamilArticle),
      READER_SAMPLE.tamilArticle,
    );

    expect(result).toMatchObject({ outcome: 'article', article: { language: 'ta' } });
    if (result.outcome === 'article') {
      expect(result.article.title).toBe('கோயம்புத்தூரில் கனமழை: பள்ளிகளுக்கு விடுமுறை');
    }
  });

  it('says a front page is not an article', async () => {
    const result = await extractor.extract(
      await sample(READER_SAMPLE.frontPage),
      READER_SAMPLE.frontPage,
    );

    expect(result.outcome).toBe('not_article');
  });

  it.each([
    ['nested far past the limit', page(chains(1, MAX_PAGE_DEPTH * 50))],
    [
      'deep chains after the closing html tag, where a first walk did not look',
      `${page('<p>ok</p>')}${chains(14, 1_000)}`,
    ],
    ['deep chains with no html tag at all', `<title>T</title>${chains(14, 1_000)}`],
    [
      'one tag with thousands of attributes',
      page(
        `<p ${Array.from({ length: MAX_ELEMENT_ATTRIBUTES * 20 }, (_, i) => `a${i}`).join(' ')}>x</p>`,
      ),
    ],
  ])('refuses a page %s, quickly, by its shape', async (_name, html) => {
    const started = Date.now();

    const result = await extractor.extract(html, URL);

    expect(result.outcome).toBe('too_complex');
    expect(Date.now() - started).toBeLessThan(EXTRACT_DEADLINE_MS);
  });

  it('gives up on a megabyte of bare words in good time, whatever it decides they are', async () => {
    const started = Date.now();

    const result = await extractor.extract(page('a '.repeat(500_000)), URL);

    expect(['article', 'not_article', 'too_complex']).toContain(result.outcome);
    expect(Date.now() - started).toBeLessThan(EXTRACT_DEADLINE_MS + 1_000);
  });
});

describe('WorkerArticleExtractor, a page that takes too long', () => {
  it('kills the worker at the deadline, answers "too complex", and reads the next page with a new one', async () => {
    const extractor = new WorkerArticleExtractor(400);
    try {
      // Warm, so the deadline below is about the page and not about starting up.
      await extractor.extract(await sample(READER_SAMPLE.frontPage), READER_SAMPLE.frontPage);

      const started = Date.now();
      const slow = await extractor.extract(SLOW_PAGE, URL);
      const took = Date.now() - started;

      expect(slow).toEqual({ outcome: 'too_complex', ms: 400 });
      // Not the second or two the page would have taken.
      expect(took).toBeLessThan(1_200);

      const next = await extractor.extract(
        await sample(READER_SAMPLE.article),
        READER_SAMPLE.article,
      );
      expect(next.outcome).toBe('article');
    } finally {
      await extractor.close();
    }
  });

  it('leaves this thread free while the worker is busy with a slow page', async () => {
    const extractor = new WorkerArticleExtractor();
    try {
      await extractor.extract(await sample(READER_SAMPLE.frontPage), READER_SAMPLE.frontPage);

      const slow = extractor.extract(SLOW_PAGE, URL);
      // Ticks every 20 ms. Parsed on this thread, the page would swallow them all.
      let longestGap = 0;
      let last = Date.now();
      let ticks = 0;
      const timer = setInterval(() => {
        const now = Date.now();
        longestGap = Math.max(longestGap, now - last);
        last = now;
        ticks += 1;
      }, 20);
      await slow;
      clearInterval(timer);

      expect(ticks).toBeGreaterThan(3);
      expect(longestGap).toBeLessThan(500);
    } finally {
      await extractor.close();
    }
  });

  it('reads pages one at a time, in order, and turns away what is past its line', async () => {
    const extractor = new WorkerArticleExtractor();
    try {
      const html = await sample(READER_SAMPLE.article);
      await extractor.extract(html, READER_SAMPLE.article);

      const asked = EXTRACT_MAX_WAITING + 4;
      const results: ExtractOutcome[] = await Promise.all(
        Array.from({ length: asked }, () => extractor.extract(html, READER_SAMPLE.article)),
      );

      const busy = results.filter((result) => result.outcome === 'busy').length;
      const read = results.filter((result) => result.outcome === 'article').length;
      expect(busy).toBe(4);
      expect(read).toBe(EXTRACT_MAX_WAITING);

      // The line empties: the next page is read.
      await expect(extractor.extract(html, READER_SAMPLE.article)).resolves.toMatchObject({
        outcome: 'article',
      });
    } finally {
      await extractor.close();
    }
  });

  it('starts again after it is closed', async () => {
    const extractor = new WorkerArticleExtractor();
    const html = await sample(READER_SAMPLE.article);

    await extractor.extract(html, READER_SAMPLE.article);
    await extractor.close();

    await expect(extractor.extract(html, READER_SAMPLE.article)).resolves.toMatchObject({
      outcome: 'article',
    });
    await extractor.close();
  });
});
