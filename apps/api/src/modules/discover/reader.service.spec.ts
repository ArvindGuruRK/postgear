/**
 * The reader's rules, against a fake Redis with real expiry, the real
 * private-network guard with its lookups answered here, and the engine's own
 * hand-written sample pages, so nothing in this file reaches a network.
 *
 * What matters most is the order: a private address costs nothing at all, the
 * eleventh read in a minute is refused before any page is asked for, and a page
 * that was read is not asked for again.
 */
import { HttpException } from '@nestjs/common';
import {
  createReaderFixtureFetch,
  type DiscoverFetch,
  extractArticle,
  GOOGLE_NEWS_BATCH_URL,
  googleNewsArticleUrl,
  MAX_PAGE_DEPTH,
  PageTooComplexError,
  READER_SAMPLE,
} from '@postgear/discover-engine';
import { assertSafeUrl, SeoCrawlError } from '@postgear/seo-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { DiscoverGate } from './discover.gate';
import type { ReaderEngine } from './reader.engine';
import type { ExtractOutcome } from './reader.extractor';
import {
  DECODES_PER_MINUTE,
  DECODES_PER_WORKSPACE,
  declaredCharset,
  LINK_CACHE_SECONDS,
  LINK_REFUSAL_SECONDS,
  PARSE_MS_PER_MINUTE,
  ParseBudget,
  READ_CACHE_SECONDS,
  READ_REFUSAL_SECONDS,
  ReaderService,
  READS_IN_FLIGHT,
  READS_PER_MINUTE,
} from './reader.service';
import { FakeRedis } from './testing/fake-redis';

// These read sample pages from disk and parse them, twenty at a time in places:
// quick alone, and past the default 5 seconds beside the whole suite on a busy machine.
jest.setTimeout(30_000);

/** What a fetch is asked with, for reading a sample page straight from the fixtures. */
const INIT = { accept: 'text/html', signal: new AbortController().signal, maxBytes: 1024 * 1024 };

const NOW = new Date('2026-11-10T10:00:00Z');
const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const PUBLIC_ADDRESS = '93.184.216.34';

const PRIVATE = 'This page is private or on your own network.';
const FAILED = 'We could not read this page. Open it in a new tab instead.';
const NOT_ARTICLE = 'This page is not an article.';
const UNRESOLVED = 'We could not open this story here. Open it in a new tab instead.';
const THROTTLED = 'Try again in a moment.';

/** A Google News link whose id needs Google to open: the sample page and batch answer resolve it. */
const NEWS_LINK = 'https://news.google.com/rss/articles/CBMiSAMPLEstoryTamil0001?oc=5';

/** An older id: the address itself, base64 behind a prefix. No request needed. */
function oldStyleLink(address: string): string {
  const bytes = Buffer.concat([
    Buffer.from([0x08, 0x13, 0x22, address.length]),
    Buffer.from(address),
    Buffer.from([0xd2, 0x01, 0x00]),
  ]);
  return googleNewsArticleUrl(bytes.toString('base64url'));
}

function build(
  options: {
    linkDecode?: boolean;
    simulation?: boolean;
    gate?: DiscoverGate;
    /** What a host resolves to. A host not named here is public. */
    dns?: Record<string, string[]>;
  } = {},
) {
  const redis = new FakeRedis();
  const samples = createReaderFixtureFetch();
  const fetch = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(samples);
  const resolve = jest.fn(async (host: string) => options.dns?.[host] ?? [PUBLIC_ADDRESS]);
  const engine: ReaderEngine = {
    simulation: options.simulation ?? false,
    guard: jest.fn((url: string) => assertSafeUrl(url, { resolve })),
    fetch,
    linkDecode: options.linkDecode ?? true,
  };
  const gate = options.gate ?? new DiscoverGate(4, 4_000);
  // The engine's own article finder, in this thread. The worker that runs it in
  // the real service has a spec of its own (`reader.extractor.spec.ts`).
  const extract = jest.fn(async (html: string, url: string): Promise<ExtractOutcome> => {
    try {
      const article = extractArticle(html, url);
      return article ? { outcome: 'article', article, ms: 5 } : { outcome: 'not_article', ms: 5 };
    } catch (error) {
      return error instanceof PageTooComplexError
        ? { outcome: 'too_complex', ms: 1 }
        : { outcome: 'failed', ms: 0 };
    }
  });
  const service = new ReaderService(engine, gate, redis.asService(), { extract });

  /** The requests made, as "GET address" or "POST address". */
  const requests = () =>
    fetch.mock.calls.map(([url, init]) => `${init.post ? 'POST' : 'GET'} ${url}`);

  return { service, engine, fetch, redis, gate, requests, extract };
}

/** The status, code and sentence of a refusal, as the web receives them. */
async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse() as { message: string; code?: string };
    return { status: error.getStatus(), message: body.message, code: body.code };
  }
  throw new Error('Expected a refusal, and the call went through.');
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  warn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ReaderService.read', () => {
  it('reads an article: the address asked for, where it was, and the text as plain paragraphs', async () => {
    const { service, requests } = build();

    const article = await service.read(ORG, READER_SAMPLE.article);

    expect(article).toMatchObject({
      url: READER_SAMPLE.article,
      finalUrl: READER_SAMPLE.article,
      title: 'Harbour market reopens after two years of repairs',
      siteName: 'The Sample Courier',
      byline: 'A. Reporter',
      language: 'en-GB',
      image: 'https://reader.example/images/harbour-market.jpg',
      publishedAt: '2026-11-04T06:30:00.000Z',
      readMinutes: 2,
    });
    expect(article.text).toContain('The old harbour market opened its gates again');
    expect(article.text).not.toMatch(/<|window\.sample|Most Read/);
    expect(article.excerpt.length).toBeLessThanOrEqual(400);
    expect(requests()).toEqual([`GET ${READER_SAMPLE.article}`]);
  });

  it('asks for an HTML page, a megabyte at most, with a deadline', async () => {
    const { service, fetch } = build();

    await service.read(ORG, READER_SAMPLE.article);

    const [, init] = fetch.mock.calls[0];
    expect(init).toMatchObject({ requireHtml: true, maxBytes: 1024 * 1024 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.post).toBeUndefined();
  });

  it('takes an address typed without a scheme', async () => {
    const { service, requests } = build();

    const article = await service.read(ORG, 'reader.example/articles/harbour-market');

    expect(article.url).toBe(READER_SAMPLE.article);
    expect(requests()).toEqual([`GET ${READER_SAMPLE.article}`]);
  });

  it('keeps Tamil text as it was written', async () => {
    const { service } = build();

    const article = await service.read(ORG, READER_SAMPLE.tamilArticle);

    expect(article.language).toBe('ta');
    expect(article.title).toBe('கோயம்புத்தூரில் கனமழை: பள்ளிகளுக்கு விடுமுறை');
    expect(article.text).toContain('கோயம்புத்தூர் மாவட்டத்தில் நேற்று இரவு முதல் கனமழை பெய்து வருகிறது.');
  });

  it.each([
    ['a private range', 'http://10.0.0.1/'],
    ['the local machine with a port', 'http://127.0.0.1:3000/admin'],
    ['the local machine by name', 'localhost:3001'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['an IPv6 loopback', 'http://[::1]/'],
    ['a name on the local network', 'https://nas.local/'],
  ])('refuses %s with the sentence, with no request and no read counted', async (_name, url) => {
    const { service, fetch, redis } = build();

    await expect(refusalOf(service.read(ORG, url))).resolves.toEqual({
      status: 422,
      code: 'read_private',
      message: PRIVATE,
    });

    expect(fetch).not.toHaveBeenCalled();
    // The read limit did not move. The one thing kept is the count of refusals,
    // by workspace, with nothing of the address in it (Module 09).
    expect(redis.keys).toEqual([`discover:addrrefused:${ORG}`]);
    expect(redis.read(`discover:addrrefused:${ORG}`)).toBe('1');
  });

  it('refuses a public name that resolves to a private address', async () => {
    const { service, fetch } = build({ dns: { 'intranet.example': ['192.168.1.20'] } });

    const refusal = await refusalOf(service.read(ORG, 'https://intranet.example/wiki'));

    expect(refusal.code).toBe('read_private');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records a private address by workspace and reason, never by the address or its host', async () => {
    const { service } = build();

    await refusalOf(service.read(ORG, 'http://10.0.0.1/secret-path'));

    expect(warn).toHaveBeenCalledWith('discover.read_private', {
      orgId: ORG,
      reason: 'private_address',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/10\.0\.0\.1|secret-path/);
  });

  it('refuses a public page that redirects into a private network, with the private sentence', async () => {
    const { service, fetch } = build();
    fetch.mockRejectedValue(
      new SeoCrawlError('unsafe_url', 'Refused.', false, { reason: 'private_address' }),
    );

    await expect(
      refusalOf(service.read(ORG, 'https://redirects.example/story')),
    ).resolves.toMatchObject({ status: 422, code: 'read_private', message: PRIVATE });
  });

  it.each([
    ['something that is not an address', 'javascript:alert(1)'],
    ['another scheme', 'ftp://reader.example/file'],
    ['credentials in the address', 'https://user:secret@reader.example/'],
  ])('answers "could not read" for %s, with no request', async (_name, url) => {
    const { service, fetch } = build();

    await expect(refusalOf(service.read(ORG, url))).resolves.toEqual({
      status: 422,
      code: 'read_failed',
      message: FAILED,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says "not an article" for a front page', async () => {
    const { service } = build();

    await expect(refusalOf(service.read(ORG, READER_SAMPLE.frontPage))).resolves.toEqual({
      status: 422,
      code: 'read_not_article',
      message: NOT_ARTICLE,
    });
  });

  it.each([
    ['a page that is missing', () => Promise.resolve({ status: 404, body: '', finalUrl: 'x' })],
    ['a login wall', () => Promise.resolve({ status: 403, body: 'Sign in', finalUrl: 'x' })],
    ['a server in trouble', () => Promise.resolve({ status: 503, body: '', finalUrl: 'x' })],
    ['a site that is down', () => Promise.reject(new Error('ECONNREFUSED'))],
    [
      'something that is not a page',
      () => Promise.reject(new SeoCrawlError('not_html', 'Not HTML.', false)),
    ],
    [
      'a page over the size cap',
      () => Promise.reject(new SeoCrawlError('too_large', 'Too large.', false)),
    ],
  ])('says "could not read" for %s, and does not remember it', async (_name, answer) => {
    const { service, fetch } = build();
    fetch.mockImplementation(answer);

    await expect(refusalOf(service.read(ORG, 'https://news.example/story'))).resolves.toEqual({
      status: 422,
      code: 'read_failed',
      message: FAILED,
    });

    // It may be back in a moment: the next read asks again.
    await refusalOf(service.read(ORG, 'https://news.example/story'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('says "could not read" for a page too deeply nested to parse, without parsing it', async () => {
    const { service, fetch } = build();
    const depth = MAX_PAGE_DEPTH * 50;
    fetch.mockResolvedValue({
      status: 200,
      body: `<html><body>${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}</body></html>`,
      finalUrl: 'https://hostile.example/',
    });

    const started = Date.now();
    const refusal = await refusalOf(service.read(ORG, 'https://hostile.example/'));

    expect(refusal).toMatchObject({ status: 422, code: 'read_failed' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('answers a page it has read from its copy for a day, whoever asks', async () => {
    const { service, fetch } = build();

    const first = await service.read(ORG, READER_SAMPLE.article);
    await jest.advanceTimersByTimeAsync((READ_CACHE_SECONDS - 60) * 1000);
    const second = await service.read(OTHER_ORG, READER_SAMPLE.article);

    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(120_000);
    await service.read(ORG, READER_SAMPLE.article);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('remembers that a page has no article for ten minutes, so it is not parsed again', async () => {
    const { service, fetch } = build();

    await refusalOf(service.read(ORG, READER_SAMPLE.frontPage));
    await expect(refusalOf(service.read(ORG, READER_SAMPLE.frontPage))).resolves.toMatchObject({
      code: 'read_not_article',
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync((READ_REFUSAL_SECONDS + 1) * 1000);
    await refusalOf(service.read(ORG, READER_SAMPLE.frontPage));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the page in Redis only, under a hash of its address', async () => {
    const { service, redis } = build();

    await service.read(ORG, `${READER_SAMPLE.article}?token=secret-in-the-address`);

    const pages = redis.keys.filter((key) => key.startsWith('discover:read:'));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatch(/^discover:read:[0-9a-f]{64}$/);
    expect(redis.keys.join(' ')).not.toMatch(/secret-in-the-address|reader\.example/);
  });

  it('keeps simulated and real copies apart', async () => {
    const real = build();
    const simulated = build({ simulation: true });

    await real.service.read(ORG, READER_SAMPLE.article);
    await simulated.service.read(ORG, READER_SAMPLE.article);

    expect(real.redis.keys.some((key) => key.includes(':sim:'))).toBe(false);
    expect(simulated.redis.keys.some((key) => key.startsWith('discover:sim:read:'))).toBe(true);
  });

  it('allows ten reads a minute per workspace, and the eleventh asks for no page', async () => {
    const { service, fetch } = build();

    for (let read = 0; read < READS_PER_MINUTE; read += 1) {
      await service.read(ORG, `https://news.example/story-${read}`);
    }
    expect(fetch).toHaveBeenCalledTimes(READS_PER_MINUTE);

    await expect(refusalOf(service.read(ORG, 'https://news.example/one-more'))).resolves.toEqual({
      status: 429,
      code: 'read_throttled',
      message: THROTTLED,
    });
    // Even one it has a copy of: the limit counts a person asking.
    await expect(
      refusalOf(service.read(ORG, 'https://news.example/story-0')),
    ).resolves.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(READS_PER_MINUTE);
    expect(warn).toHaveBeenCalledWith('discover.read_throttled', { orgId: ORG });

    // Another workspace has a count of its own, and a minute later so does this one.
    await expect(service.read(OTHER_ORG, 'https://news.example/story-0')).resolves.toBeDefined();
    await jest.advanceTimersByTimeAsync(61_000);
    await expect(service.read(ORG, 'https://news.example/one-more')).resolves.toBeDefined();
  });

  it('says "try again" when no slot comes free, rather than "could not read"', async () => {
    const gate = new DiscoverGate(1, 10);
    const { service, fetch } = build({ gate });
    const held = await gate.acquire();

    const waiting = refusalOf(service.read(ORG, READER_SAMPLE.article));
    await jest.advanceTimersByTimeAsync(20);

    await expect(waiting).resolves.toMatchObject({ status: 429, code: 'read_throttled' });
    expect(fetch).not.toHaveBeenCalled();
    held?.();
  });
});

describe('ReaderService.read, a Google News link', () => {
  it('resolves the link through its page and one POST, then reads the publisher', async () => {
    const { service, requests } = build();

    const article = await service.read(ORG, NEWS_LINK);

    expect(article).toMatchObject({
      url: NEWS_LINK,
      finalUrl: READER_SAMPLE.tamilArticle,
      language: 'ta',
    });
    expect(requests()).toEqual([
      'GET https://news.google.com/rss/articles/CBMiSAMPLEstoryTamil0001',
      `POST ${GOOGLE_NEWS_BATCH_URL}`,
      `GET ${READER_SAMPLE.tamilArticle}`,
    ]);
  });

  it('remembers where a link leads for seven days, and the page for one', async () => {
    const { service, requests, redis } = build();

    await service.read(ORG, NEWS_LINK);
    await jest.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
    await service.read(ORG, NEWS_LINK);

    // The page was asked for again, the link was not.
    expect(requests().filter((request) => request.includes('news.google.com'))).toHaveLength(2);
    expect(
      requests().filter((request) => request.endsWith(READER_SAMPLE.tamilArticle)),
    ).toHaveLength(2);

    const links = redis.keys.filter((key) => key.startsWith('discover:link:'));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(/^discover:link:[0-9a-f]{64}$/);

    await jest.advanceTimersByTimeAsync(LINK_CACHE_SECONDS * 1000);
    await service.read(ORG, NEWS_LINK);
    expect(requests().filter((request) => request.includes('news.google.com'))).toHaveLength(4);
  });

  it('opens an older link with no request to Google at all', async () => {
    const { service, requests } = build();

    const article = await service.read(ORG, oldStyleLink(READER_SAMPLE.article));

    expect(article.finalUrl).toBe(READER_SAMPLE.article);
    expect(requests()).toEqual([`GET ${READER_SAMPLE.article}`]);
  });

  it('says to open it in a new tab when link decoding is switched off, and asks nobody', async () => {
    const { service, fetch } = build({ linkDecode: false });

    await expect(refusalOf(service.read(ORG, NEWS_LINK))).resolves.toEqual({
      status: 422,
      code: 'link_unresolved',
      message: UNRESOLVED,
    });
    expect(fetch).not.toHaveBeenCalled();

    // An ordinary page still reads: the switch is about Google News links only.
    await expect(service.read(ORG, READER_SAMPLE.article)).resolves.toBeDefined();
  });

  it.each([
    ['the page is missing', { status: 404, body: '', finalUrl: 'x' }],
    ['the page has no signature', { status: 200, body: '<html></html>', finalUrl: 'x' }],
  ])('says the story could not be opened when %s, with no retry', async (_name, page) => {
    const { service, fetch } = build();
    fetch.mockResolvedValue(page);

    await expect(refusalOf(service.read(ORG, NEWS_LINK))).resolves.toEqual({
      status: 422,
      code: 'link_unresolved',
      message: UNRESOLVED,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('says the story could not be opened when the answer is malformed, with no retry', async () => {
    const { service, fetch } = build();
    const samples = createReaderFixtureFetch();
    fetch.mockImplementation(async (url, init) =>
      init.post
        ? { status: 200, body: ')]}\'\n\n[["wrb.fr","Fbv4je",null]]', finalUrl: url }
        : samples(url, init),
    );

    await expect(refusalOf(service.read(ORG, NEWS_LINK))).resolves.toMatchObject({
      code: 'link_unresolved',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not open a link that leads to a private address, and reads nothing', async () => {
    const { service, requests } = build();

    const refusal = await refusalOf(service.read(ORG, oldStyleLink('http://10.0.0.1/internal')));

    expect(refusal).toMatchObject({ status: 422, code: 'link_unresolved', message: UNRESOLVED });
    expect(requests()).toEqual([]);
    expect(warn).toHaveBeenCalledWith('discover.read_private', {
      orgId: ORG,
      reason: 'private_address',
      via: 'link',
    });
  });

  it('resolves twenty links a minute through Google for the whole deployment, and no more', async () => {
    const { service, fetch } = build();
    const link = (index: number) =>
      `https://news.google.com/rss/articles/CBMiSAMPLEstory${String(index).padStart(6, '0')}`;

    // Spread over workspaces, so no single one is throttled.
    for (let index = 0; index < DECODES_PER_MINUTE; index += 1) {
      await service.resolveLink(`org-${index}`, link(index));
    }
    const asked = fetch.mock.calls.length;
    expect(asked).toBe(DECODES_PER_MINUTE * 2);

    await expect(refusalOf(service.resolveLink('org-late', link(999)))).resolves.toMatchObject({
      status: 422,
      code: 'link_unresolved',
    });
    expect(fetch).toHaveBeenCalledTimes(asked);

    // One already resolved is free, and an older link needs no budget.
    await expect(service.resolveLink('org-late', link(0))).resolves.toBe(
      READER_SAMPLE.tamilArticle,
    );
    await expect(
      service.resolveLink('org-late', oldStyleLink(READER_SAMPLE.article)),
    ).resolves.toBe(READER_SAMPLE.article);
    expect(fetch).toHaveBeenCalledTimes(asked);

    await jest.advanceTimersByTimeAsync(61_000);
    await expect(service.resolveLink('org-late', link(999))).resolves.toBe(
      READER_SAMPLE.tamilArticle,
    );
  });
});

describe('ReaderService.resolveLink', () => {
  it('answers the publisher address behind a Google News link, and reads no page', async () => {
    const { service, requests } = build();

    await expect(service.resolveLink(ORG, NEWS_LINK)).resolves.toBe(READER_SAMPLE.tamilArticle);
    expect(requests()).toEqual([
      'GET https://news.google.com/rss/articles/CBMiSAMPLEstoryTamil0001',
      `POST ${GOOGLE_NEWS_BATCH_URL}`,
    ]);
  });

  it.each([
    ['an ordinary address', READER_SAMPLE.article],
    ['a lookalike host', 'https://news.google.com.evil.example/rss/articles/CBMiSAMPLE0001'],
    ['something that is not an address', 'not an address'],
  ])('refuses %s without a request or a count', async (_name, url) => {
    const { service, fetch, redis } = build();

    await expect(refusalOf(service.resolveLink(ORG, url))).resolves.toMatchObject({
      status: 422,
      code: 'link_unresolved',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(redis.keys).toEqual([]);
  });

  it('counts against the same ten a minute as reading', async () => {
    const { service } = build();
    for (let read = 0; read < READS_PER_MINUTE; read += 1) {
      await service.read(ORG, `https://news.example/story-${read}`);
    }

    await expect(refusalOf(service.resolveLink(ORG, NEWS_LINK))).resolves.toMatchObject({
      status: 429,
      code: 'read_throttled',
    });
  });

  it('says the story could not be opened when link decoding is off', async () => {
    const { service, fetch } = build({ linkDecode: false });

    await expect(refusalOf(service.resolveLink(ORG, NEWS_LINK))).resolves.toMatchObject({
      code: 'link_unresolved',
      message: UNRESOLVED,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the budget of parsing time', () => {
  const MINUTE = 60_000;
  const START = Date.UTC(2026, 10, 10, 10, 0, 0);

  it('lets a workspace through until its pages have taken the limit, then holds it', () => {
    const budget = new ParseBudget(1_500);

    expect(budget.isSpent('a', START)).toBe(false);
    budget.spend('a', 40, START);
    budget.spend('a', 60, START + 1_000);
    expect(budget.isSpent('a', START + 2_000)).toBe(false);

    // One slow page always gets through, and takes the rest of the minute with it.
    budget.spend('a', 2_000, START + 3_000);
    expect(budget.isSpent('a', START + 4_000)).toBe(true);
    // Another workspace is not held for it.
    expect(budget.isSpent('b', START + 4_000)).toBe(false);
  });

  it('starts over with the next minute', () => {
    const budget = new ParseBudget(1_500);
    budget.spend('a', 5_000, START);

    expect(budget.isSpent('a', START + MINUTE - 1)).toBe(true);
    expect(budget.isSpent('a', START + MINUTE)).toBe(false);

    budget.spend('a', 10, START + MINUTE);
    expect(budget.isSpent('a', START + MINUTE + 1)).toBe(false);
  });

  it('never counts a clock that went backwards as time given back', () => {
    const budget = new ParseBudget(100);
    budget.spend('a', 90, START);
    budget.spend('a', -500, START);

    expect(budget.isSpent('a', START)).toBe(false);
    budget.spend('a', 10, START);
    expect(budget.isSpent('a', START)).toBe(true);
  });

  it('holds a workspace whose pages were slow before the next page is asked for', async () => {
    const { service, fetch } = build();
    await service.read(ORG, READER_SAMPLE.article);
    expect(fetch).toHaveBeenCalledTimes(1);

    // As if that page had been one built to be slow.
    (service as unknown as { parseTime: ParseBudget }).parseTime.spend(ORG, PARSE_MS_PER_MINUTE);

    await expect(refusalOf(service.read(ORG, 'https://news.example/next'))).resolves.toEqual({
      status: 429,
      code: 'read_throttled',
      message: THROTTLED,
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    // What it already has a copy of still answers: no page is parsed for it.
    await expect(service.read(ORG, READER_SAMPLE.article)).resolves.toBeDefined();
    // Another workspace reads as usual, and so does this one a minute later.
    await expect(service.read(OTHER_ORG, 'https://news.example/next')).resolves.toBeDefined();
    await jest.advanceTimersByTimeAsync(61_000);
    await expect(service.read(ORG, 'https://news.example/later')).resolves.toBeDefined();
  });
});

describe('what one workspace can take from the others', () => {
  /** A page that costs the worker nearly the whole budget, like one built to be slow. */
  const SLOW: ExtractOutcome = { outcome: 'too_complex', ms: PARSE_MS_PER_MINUTE - 40 };

  it('parses at most two pages for a burst of ten reads at once, and refuses the rest unparsed', async () => {
    const { service, fetch, extract } = build();
    // Two places in flight, so at most two of these are ever used.
    extract.mockResolvedValueOnce(SLOW).mockResolvedValueOnce(SLOW);

    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        refusalOf(service.read(ORG, `https://hostile.example/page-${index}`)),
      ),
    );

    expect(extract).toHaveBeenCalledTimes(READS_IN_FLIGHT);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(READS_IN_FLIGHT);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(10 - READS_IN_FLIGHT);

    // The budget is spent now: the next page is not even fetched.
    const fetched = fetch.mock.calls.length;
    await expect(
      refusalOf(service.read(ORG, 'https://hostile.example/one-more')),
    ).resolves.toMatchObject({ status: 429, code: 'read_throttled' });
    expect(fetch).toHaveBeenCalledTimes(fetched);
    // And nobody else is held for it.
    await expect(service.read(OTHER_ORG, READER_SAMPLE.article)).resolves.toBeDefined();
  });

  it('checks the budget again after the fetch, so a page that was on its way is not parsed either', async () => {
    const { service, fetch, extract } = build();
    const samples = createReaderFixtureFetch();
    let letGo: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    // The second page's fetch waits until the first page has been parsed and charged.
    fetch.mockImplementation(async (url, init) => {
      if (url.endsWith('/second')) await held;
      return samples(url, init);
    });
    extract.mockResolvedValueOnce({ outcome: 'too_complex', ms: PARSE_MS_PER_MINUTE });

    const second = refusalOf(service.read(ORG, 'https://hostile.example/second'));
    await refusalOf(service.read(ORG, 'https://hostile.example/first'));
    letGo();

    await expect(second).resolves.toMatchObject({ status: 429, code: 'read_throttled' });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('frees its place when a read ends, however it ends', async () => {
    const { service, fetch } = build();
    fetch.mockRejectedValueOnce(new Error('ECONNRESET'));

    await refusalOf(service.read(ORG, 'https://down.example/a'));
    await refusalOf(service.read(ORG, READER_SAMPLE.frontPage));

    // Two reads came and went: a third and a fourth still have places.
    await expect(
      Promise.all([
        service.read(ORG, READER_SAMPLE.article),
        service.read(ORG, READER_SAMPLE.tamilArticle),
      ]),
    ).resolves.toHaveLength(2);
  });

  it('charges a page what the worker really spent on it, and remembers a page it gave up on', async () => {
    const { service, fetch, extract } = build();
    extract.mockResolvedValueOnce({ outcome: 'too_complex', ms: 2_000 });

    await expect(refusalOf(service.read(ORG, 'https://hostile.example/slow'))).resolves.toEqual({
      status: 422,
      code: 'read_failed',
      message: FAILED,
    });

    // Remembered: another workspace asking for it does not make the worker try again.
    await expect(
      refusalOf(service.read(OTHER_ORG, 'https://hostile.example/slow')),
    ).resolves.toMatchObject({ code: 'read_failed' });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    // And the workspace that asked has spent its minute.
    await expect(refusalOf(service.read(ORG, 'https://news.example/next'))).resolves.toMatchObject({
      status: 429,
    });
  });

  it('says "try again" when the worker has too many pages waiting, and holds it against nobody', async () => {
    const { service, extract } = build();
    extract.mockResolvedValue({ outcome: 'busy' });

    await expect(refusalOf(service.read(ORG, READER_SAMPLE.article))).resolves.toEqual({
      status: 429,
      code: 'read_throttled',
      message: THROTTLED,
    });
    expect(warn).not.toHaveBeenCalledWith('discover.read_throttled', expect.anything());

    // Nothing was remembered about the page: it reads as soon as there is room.
    extract.mockResolvedValue({
      outcome: 'article',
      ms: 5,
      article: extractArticle(
        (await createReaderFixtureFetch()(READER_SAMPLE.article, INIT)).body,
        READER_SAMPLE.article,
      ) as never,
    });
    await expect(service.read(ORG, READER_SAMPLE.article)).resolves.toBeDefined();
  });

  it('does not remember a page when it was the worker that failed', async () => {
    const { service, extract, fetch } = build();
    extract.mockResolvedValueOnce({ outcome: 'failed', ms: 0 });

    await expect(refusalOf(service.read(ORG, READER_SAMPLE.article))).resolves.toMatchObject({
      status: 422,
      code: 'read_failed',
    });
    await expect(service.read(ORG, READER_SAMPLE.article)).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives each workspace a share of the links resolved through Google', async () => {
    const { service, fetch } = build();
    const link = (index: number) =>
      `https://news.google.com/rss/articles/CBMiSAMPLEshare${String(index).padStart(6, '0')}`;

    for (let index = 0; index < DECODES_PER_WORKSPACE; index += 1) {
      await service.resolveLink(ORG, link(index));
    }
    const asked = fetch.mock.calls.length;

    await expect(refusalOf(service.resolveLink(ORG, link(99)))).resolves.toMatchObject({
      status: 422,
      code: 'link_unresolved',
    });
    expect(fetch).toHaveBeenCalledTimes(asked);
    // Far short of the deployment's twenty: another workspace still resolves.
    expect(DECODES_PER_WORKSPACE).toBeLessThan(DECODES_PER_MINUTE);
    await expect(service.resolveLink(OTHER_ORG, link(99))).resolves.toBe(
      READER_SAMPLE.tamilArticle,
    );
  });

  it('remembers a link that would not open for a few minutes, and asks Google once', async () => {
    const { service, fetch } = build();
    fetch.mockResolvedValue({ status: 404, body: '', finalUrl: 'x' });

    await refusalOf(service.read(ORG, NEWS_LINK));
    await expect(refusalOf(service.read(OTHER_ORG, NEWS_LINK))).resolves.toMatchObject({
      code: 'link_unresolved',
      message: UNRESOLVED,
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    // Then it may be tried again.
    fetch.mockImplementation(createReaderFixtureFetch());
    await jest.advanceTimersByTimeAsync((LINK_REFUSAL_SECONDS + 1) * 1000);
    await expect(service.read(OTHER_ORG, NEWS_LINK)).resolves.toMatchObject({
      finalUrl: READER_SAMPLE.tamilArticle,
    });
  });
});

describe('a page in another encoding', () => {
  it('reads the encoding from the header first, then from a meta tag near the top', () => {
    expect(declaredCharset('text/html; charset=UTF-8', '')).toBe('utf-8');
    expect(declaredCharset('text/html; charset="windows-1251"', '')).toBe('windows-1251');
    expect(declaredCharset('text/html', '<meta charset="Shift_JIS">')).toBe('shift_jis');
    expect(
      declaredCharset(null, '<meta http-equiv="Content-Type" content="text/html; charset=euc-kr">'),
    ).toBe('euc-kr');
    expect(declaredCharset('text/html', '<html><body>plain</body></html>')).toBeNull();
    // A header wins over the page's own word.
    expect(declaredCharset('text/html; charset=utf-8', '<meta charset="latin1">')).toBe('utf-8');
  });

  it.each([
    ['in the header', 'text/html; charset=windows-1251', ''],
    ['in a meta tag', 'text/html', '<meta charset="shift_jis">'],
  ])(
    'says "could not read" for a page that names another encoding %s, and parses nothing',
    async (_name, contentType, meta) => {
      const { service, fetch, extract } = build();
      const sample = await createReaderFixtureFetch()(READER_SAMPLE.article, INIT);
      fetch.mockResolvedValue({ ...sample, contentType, body: meta + sample.body });

      await expect(refusalOf(service.read(ORG, 'https://news.example/story'))).resolves.toEqual({
        status: 422,
        code: 'read_failed',
        message: FAILED,
      });
      expect(extract).not.toHaveBeenCalled();
    },
  );

  it('reads a page that says it is UTF-8, or says nothing', async () => {
    const { service, fetch } = build();
    const sample = await createReaderFixtureFetch()(READER_SAMPLE.article, INIT);

    fetch.mockResolvedValue({ ...sample, contentType: 'text/html; charset=utf-8' });
    await expect(service.read(ORG, 'https://news.example/a')).resolves.toBeDefined();
    fetch.mockResolvedValue({ ...sample, contentType: null });
    await expect(service.read(ORG, 'https://news.example/b')).resolves.toBeDefined();
  });
});

describe('ReaderService: refused addresses are counted (Module 09)', () => {
  const PRIVATE_PAGE = 'http://10.0.0.1/';

  it('answers 429 after thirty refusals in a minute, before the guard runs again', async () => {
    const { service, engine, fetch } = build();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await expect(refusalOf(service.read(ORG, PRIVATE_PAGE))).resolves.toMatchObject({
        status: 422,
        code: 'read_private',
      });
    }
    expect(engine.guard).toHaveBeenCalledTimes(30);

    await expect(refusalOf(service.read(ORG, PRIVATE_PAGE))).resolves.toEqual({
      status: 429,
      code: 'read_throttled',
      message: 'Try again in a moment.',
    });
    // A good address waits too: the workspace is resting, whatever it asks for.
    await expect(refusalOf(service.read(ORG, READER_SAMPLE.article))).resolves.toMatchObject({
      status: 429,
    });

    expect(engine.guard).toHaveBeenCalledTimes(30);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('counts each workspace on its own, and starts again after a minute', async () => {
    const { service, fetch } = build();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await refusalOf(service.read(ORG, PRIVATE_PAGE));
    }

    await expect(service.read('org-2', READER_SAMPLE.article)).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(61_000);
    await expect(refusalOf(service.read(ORG, PRIVATE_PAGE))).resolves.toMatchObject({
      status: 422,
      code: 'read_private',
    });
    await expect(service.read(ORG, READER_SAMPLE.article)).resolves.toBeDefined();
  });

  it('does not count an address that was fine, or text that is not an address', async () => {
    const { service, redis } = build();

    await service.read(ORG, READER_SAMPLE.article);
    await refusalOf(service.read(ORG, 'javascript:alert(1)'));

    expect(redis.keys).not.toContain(`discover:addrrefused:${ORG}`);
  });
});
