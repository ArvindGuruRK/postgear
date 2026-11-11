import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createReaderFixtureFetch, READER_SAMPLE } from '../simulation';
import type { DiscoverFetch, DiscoverFetchInit, DiscoverFetchResponse } from '../types';
import {
  batchRequestBody,
  decodeGoogleNewsLink,
  decodeLocally,
  GOOGLE_NEWS_BATCH_URL,
  GOOGLE_NEWS_HOST,
  googleNewsArticleId,
  googleNewsArticleUrl,
  isGoogleNewsLink,
  LinkUnresolvedError,
  readBatchAnswer,
  readDecodingParams,
} from './google-news-link';

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'reader');
const ARTICLE_PAGE = readFileSync(join(FIXTURES, 'google-news-article.sample.html'), 'utf8');
const BATCH_ANSWER = readFileSync(join(FIXTURES, 'google-news-batch.sample.txt'), 'utf8');

/** The id of the sample story: a newer one, which only the two requests can turn back. */
const ID = 'CBMiSAMPLEstoryTamil0001';
const SIGNATURE = 'ATR_sample_signature_0123456789abcdef';
const TIMESTAMP = '1793781000';
const PUBLISHER = 'https://publisher.example/story';
const FORM = 'application/x-www-form-urlencoded;charset=UTF-8';

/**
 * An id the way the older links were made: three bytes, the address's length (one
 * byte, or two from 128 bytes up), the address, and three bytes to end.
 */
function olderId(address: string, options: { suffix?: boolean } = {}): string {
  const bytes = [...Buffer.from(address, 'utf8')];
  const length =
    bytes.length < 0x80 ? [bytes.length] : [0x80 | (bytes.length & 0x7f), bytes.length >> 7];
  const end = options.suffix === false ? [] : [0xd2, 0x01, 0x00];

  return Buffer.from([0x08, 0x13, 0x22, ...length, ...bytes, ...end]).toString('base64url');
}

/** A batchexecute answer holding `inner`, with the guard line and the blank line before it. */
function batchAnswer(inner: unknown, separator = '\n\n'): string {
  const rows = [['wrb.fr', 'Fbv4je', JSON.stringify(inner), null, null, null, 'generic']];
  return `)]}'${separator}${JSON.stringify(rows)}\n`;
}

type Answer = Partial<DiscoverFetchResponse> | Error;

/** A fetch that answers each request in turn, and fails the test on one more than it was given. */
function fetchAnswering(...answers: Answer[]) {
  const calls: { url: string; init: DiscoverFetchInit }[] = [];
  const fetchMock: DiscoverFetch = async (url, init) => {
    calls.push({ url, init });
    const answer = answers[calls.length - 1];
    if (answer === undefined) throw new Error('A request nobody expected.');
    if (answer instanceof Error) throw answer;
    return { status: 200, body: '', finalUrl: url, ...answer };
  };
  return { fetchMock, calls };
}

/** Why a link did not resolve. Fails the test when it did, or when anything else was thrown. */
async function reasonOf(promise: Promise<string>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LinkUnresolvedError) return error.reason;
    throw error;
  }
  throw new Error('Expected the link not to resolve, and it did.');
}

describe('googleNewsArticleId', () => {
  it.each([
    ['an RSS link, as the feeds write it', `https://news.google.com/rss/articles/${ID}?oc=5`],
    ['an RSS link with no query', `https://news.google.com/rss/articles/${ID}`],
    ['an article link', `https://news.google.com/articles/${ID}`],
    ['a read link', `https://news.google.com/read/${ID}?hl=ta&gl=IN&ceid=IN:ta`],
    ['an RSS read link', `https://news.google.com/rss/read/${ID}`],
    ['a link with a fragment', `https://news.google.com/articles/${ID}#top`],
    ['a link in capitals', `HTTPS://NEWS.GOOGLE.COM/rss/articles/${ID}`],
    ['a link over plain http', `http://news.google.com/rss/articles/${ID}`],
  ])('reads the id out of %s', (_what, url) => {
    expect(googleNewsArticleId(url)).toBe(ID);
    expect(isGoogleNewsLink(url)).toBe(true);
  });

  it.each([
    ['another host', `https://example.com/rss/articles/${ID}`],
    ['a host that only begins like it', `https://news.google.com.evil.example/rss/articles/${ID}`],
    ['a host that only ends like it', `https://evilnews.google.com/rss/articles/${ID}`],
    ['another Google host', `https://www.google.com/rss/articles/${ID}`],
    ['the host in the path', `https://evil.example/news.google.com/rss/articles/${ID}`],
    ['the host as a user name', `https://news.google.com@evil.example/rss/articles/${ID}`],
    [
      'a topic',
      'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB',
    ],
    ['the front page', 'https://news.google.com/'],
    ['the top stories feed', 'https://news.google.com/rss?hl=ta&gl=IN&ceid=IN:ta'],
    ['a search', 'https://news.google.com/rss/search?q=%22Acme%22'],
    ['something after the id', `https://news.google.com/rss/articles/${ID}/extra`],
    ['something before the path', `https://news.google.com/x/rss/articles/${ID}`],
    ['an id that is too short', 'https://news.google.com/rss/articles/CBMi'],
    ['an id with a character no id has', `https://news.google.com/rss/articles/${ID}!`],
    ['an id with an encoded slash', `https://news.google.com/rss/articles/${ID}%2F..`],
    ['a script', `javascript:location='https://news.google.com/rss/articles/${ID}'`],
    ['another scheme', `ftp://news.google.com/rss/articles/${ID}`],
    ['a path with no host', `/rss/articles/${ID}`],
    ['words', 'not a link at all'],
    ['nothing', ''],
  ])('reads no id out of %s', (_what, url) => {
    expect(googleNewsArticleId(url)).toBeNull();
    expect(isGoogleNewsLink(url)).toBe(false);
  });

  it('builds the address of an article from its id, on Google News and nowhere else', () => {
    const url = googleNewsArticleUrl(ID);

    expect(url).toBe(`https://news.google.com/rss/articles/${ID}`);
    expect(new URL(url).hostname).toBe(GOOGLE_NEWS_HOST);
    expect(googleNewsArticleId(url)).toBe(ID);
    expect(GOOGLE_NEWS_BATCH_URL).toBe('https://news.google.com/_/DotsSplashUi/data/batchexecute');
    // The endpoint itself is not an article link.
    expect(isGoogleNewsLink(GOOGLE_NEWS_BATCH_URL)).toBe(false);
  });
});

describe('decodeLocally', () => {
  it('reads the address out of an older id, with or without its ending', () => {
    expect(decodeLocally(olderId(PUBLISHER))).toBe(PUBLISHER);
    expect(decodeLocally(olderId(PUBLISHER, { suffix: false }))).toBe(PUBLISHER);
  });

  it('reads the two-byte length of an address of 128 bytes or more', () => {
    for (const length of [127, 128, 129, 200, 255, 256, 1_000]) {
      const address = `https://publisher.example/${'a'.repeat(length - 26)}`;

      expect(Buffer.byteLength(address)).toBe(length);
      expect([length, decodeLocally(olderId(address))]).toEqual([length, address]);
    }
  });

  it('counts the length in bytes, so an address in Tamil comes back whole', () => {
    const word = [0x0b9a, 0x0bc6, 0x0ba9, 0x0bcd, 0x0ba9, 0x0bc8]
      .map((code) => String.fromCodePoint(code))
      .join('');
    const address = `https://publisher.example/${word}`;

    // The address is written out encoded, the way a link is.
    expect(decodeLocally(olderId(address))).toBe(new URL(address).toString());
  });

  it('answers null for a newer id, whose payload is a token and not an address', () => {
    expect(decodeLocally(ID)).toBeNull();
    expect(decodeLocally(olderId('AU_yqLabcdefghijklmnopqrstuvwxyz0123456789'))).toBeNull();
  });

  it.each([
    ['nothing', ''],
    ['text that is not base64', '!!! not base64 !!!'],
    ['base64 of something else', Buffer.from('hello there, world').toString('base64url')],
    ['only the three opening bytes', Buffer.from([0x08, 0x13, 0x22]).toString('base64url')],
    ['a length of zero', Buffer.from([0x08, 0x13, 0x22, 0, 0x41]).toString('base64url')],
    [
      'a length longer than what follows',
      Buffer.from([0x08, 0x13, 0x22, 90, ...Buffer.from('https://a.example/')]).toString(
        'base64url',
      ),
    ],
    [
      'other opening bytes',
      Buffer.from([0x08, 0x14, 0x22, 18, ...Buffer.from('https://a.example/')]).toString(
        'base64url',
      ),
    ],
  ])('answers null for %s', (_what, id) => {
    expect(decodeLocally(id)).toBeNull();
  });

  it.each([
    ['a script', 'javascript:alert(document.cookie)'],
    ['a data address', 'data:text/html,<script>alert(1)</script>'],
    ['a file', 'file:///etc/passwd'],
    ['words', 'not an address at all'],
    ['a link straight back to Google News', `https://news.google.com/rss/articles/${ID}`],
    ['Google News in capitals', `https://NEWS.GOOGLE.COM/articles/${ID}`],
  ])('answers null when what is inside is %s', (_what, address) => {
    expect(decodeLocally(olderId(address))).toBeNull();
  });

  it('keeps only web addresses, plain http among them', () => {
    expect(decodeLocally(olderId('http://publisher.example/old'))).toBe(
      'http://publisher.example/old',
    );
  });
});

describe('readDecodingParams', () => {
  it('reads the signature and the timestamp off the sample article page', () => {
    expect(readDecodingParams(ARTICLE_PAGE)).toEqual({
      signature: SIGNATURE,
      timestamp: TIMESTAMP,
    });
  });

  it('reads them whichever way the attributes are quoted and ordered', () => {
    expect(
      readDecodingParams(`<div data-n-a-ts='${TIMESTAMP}' data-n-a-sg=${SIGNATURE}></div>`),
    ).toEqual({ signature: SIGNATURE, timestamp: TIMESTAMP });
  });

  it.each([
    ['no page', ''],
    [
      'a page with neither',
      '<html><body><c-wiz><div jscontroller="x"></div></c-wiz></body></html>',
    ],
    ['only the signature', `<div data-n-a-sg="${SIGNATURE}"></div>`],
    ['only the timestamp', `<div data-n-a-ts="${TIMESTAMP}"></div>`],
    [
      'the two on different tags',
      `<div data-n-a-sg="${SIGNATURE}"></div><div data-n-a-ts="${TIMESTAMP}"></div>`,
    ],
    [
      'a signature with a space in it',
      `<div data-n-a-sg="has a space" data-n-a-ts="${TIMESTAMP}"></div>`,
    ],
    [
      'a signature that would break out of the form',
      `<div data-n-a-sg='a","b"],["c' data-n-a-ts="${TIMESTAMP}"></div>`,
    ],
    ['a signature that is too short', `<div data-n-a-sg="short" data-n-a-ts="${TIMESTAMP}"></div>`],
    ['an empty signature', `<div data-n-a-sg="" data-n-a-ts="${TIMESTAMP}"></div>`],
    ['a timestamp in words', `<div data-n-a-sg="${SIGNATURE}" data-n-a-ts="soon"></div>`],
    ['a timestamp with a sign', `<div data-n-a-sg="${SIGNATURE}" data-n-a-ts="-1793781000"></div>`],
    [
      'a timestamp that is too long',
      `<div data-n-a-sg="${SIGNATURE}" data-n-a-ts="${'9'.repeat(17)}"></div>`,
    ],
    [
      'the attributes inside a comment',
      `<!-- <div data-n-a-sg="${SIGNATURE}" data-n-a-ts="${TIMESTAMP}"> -->`,
    ],
    [
      'the attributes inside a script',
      `<script>var x = '<div data-n-a-sg="${SIGNATURE}" data-n-a-ts="${TIMESTAMP}">';</script>`,
    ],
  ])('answers null for %s', (_what, html) => {
    expect(readDecodingParams(html)).toBeNull();
  });

  it('judges the first tag that carries both, and never looks for a better one', () => {
    const page = [
      `<div data-n-a-sg="bad one!" data-n-a-ts="${TIMESTAMP}"></div>`,
      `<div data-n-a-sg="${SIGNATURE}" data-n-a-ts="${TIMESTAMP}"></div>`,
    ].join('');

    expect(readDecodingParams(page)).toBeNull();
  });
});

describe('batchRequestBody', () => {
  const body = batchRequestBody(ID, TIMESTAMP, SIGNATURE);
  const envelope = JSON.parse(decodeURIComponent(body.slice('f.req='.length))) as [
    [[string, string]],
  ];

  it('is one form field, encoded', () => {
    expect(body.startsWith('f.req=')).toBe(true);
    expect(body.slice('f.req='.length)).toMatch(/^[A-Za-z0-9%._~*'()!-]+$/);
    expect(body).not.toContain('&');
  });

  it('wraps the request in the envelope the endpoint reads', () => {
    expect(envelope).toHaveLength(1);
    expect(envelope[0]).toHaveLength(1);
    expect(envelope[0][0][0]).toBe('Fbv4je');
    expect(typeof envelope[0][0][1]).toBe('string');
  });

  it('holds the id, the timestamp as a number and the signature, in that order', () => {
    const request = JSON.parse(envelope[0][0][1]) as unknown[];

    expect(request[0]).toBe('garturlreq');
    expect(Array.isArray(request[1])).toBe(true);
    expect(request.slice(2)).toEqual([ID, Number(TIMESTAMP), SIGNATURE]);
    expect(request).toHaveLength(5);
  });

  it('is the same for the same story, and different for another', () => {
    expect(batchRequestBody(ID, TIMESTAMP, SIGNATURE)).toBe(body);
    expect(batchRequestBody(`${ID}x`, TIMESTAMP, SIGNATURE)).not.toBe(body);
  });
});

describe('readBatchAnswer', () => {
  it("reads the publisher's address out of the sample answer", () => {
    expect(readBatchAnswer(BATCH_ANSWER)).toBe(READER_SAMPLE.tamilArticle);
  });

  it('reads it whichever line ending the blank line has', () => {
    const unix = BATCH_ANSWER.replace(/\r?\n/g, '\n');
    const windows = BATCH_ANSWER.replace(/\r?\n/g, '\r\n');

    expect(unix).toContain(")]}'\n\n");
    expect(windows).toContain(")]}'\r\n\r\n");
    expect(readBatchAnswer(unix)).toBe(READER_SAMPLE.tamilArticle);
    expect(readBatchAnswer(windows)).toBe(READER_SAMPLE.tamilArticle);
    expect(readBatchAnswer(batchAnswer(['garturlres', PUBLISHER, 1]))).toBe(PUBLISHER);
    expect(readBatchAnswer(batchAnswer(['garturlres', PUBLISHER, 1], '\r\n\r\n'))).toBe(PUBLISHER);
  });

  it.each([
    ['nothing', ''],
    ['only the guard line', ")]}'\n\n"],
    [
      'a body with no guard line',
      JSON.stringify([['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', PUBLISHER])]]),
    ],
    [
      'a guard line and one line break',
      `)]}'\n${JSON.stringify([['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', PUBLISHER])]])}`,
    ],
    ['text that is not JSON', ")]}'\n\n<html>Sorry, something went wrong.</html>"],
    ['an empty list', ")]}'\n\n[]"],
    ['an object', ")]}'\n\n{}"],
    ['a row that is not a list', ')]}\'\n\n["wrb.fr"]'],
    ['a row with no answer in it', ')]}\'\n\n[["wrb.fr","Fbv4je",null]]'],
    ['an answer that is not JSON inside', ')]}\'\n\n[["wrb.fr","Fbv4je","not json"]]'],
    ['an error row', batchAnswer(['er', null, null, null, null, 400])],
    ["another call's answer", batchAnswer(['otherres', PUBLISHER])],
    ['an answer with no address', batchAnswer(['garturlres'])],
    ['an answer whose address is a number', batchAnswer(['garturlres', 42])],
    ['an answer whose address is a script', batchAnswer(['garturlres', 'javascript:alert(1)'])],
    ['an answer whose address is a data address', batchAnswer(['garturlres', 'data:text/html,x'])],
    ['an answer whose address is words', batchAnswer(['garturlres', 'see you later'])],
    [
      'an answer that leads straight back to Google News',
      batchAnswer(['garturlres', `https://news.google.com/rss/articles/${ID}`]),
    ],
  ])('answers null for %s', (_what, body) => {
    expect(readBatchAnswer(body)).toBeNull();
  });

  it('reads only the first row', () => {
    const rows = [
      ['wrb.fr', 'Fbv4je', JSON.stringify(['er'])],
      ['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', PUBLISHER])],
    ];

    expect(readBatchAnswer(`)]}'\n\n${JSON.stringify(rows)}`)).toBeNull();
  });
});

describe('decodeGoogleNewsLink', () => {
  it('resolves an older id by itself, with no request at all', async () => {
    const { fetchMock, calls } = fetchAnswering();

    await expect(decodeGoogleNewsLink(olderId(PUBLISHER), { fetch: fetchMock })).resolves.toBe(
      PUBLISHER,
    );
    expect(calls).toEqual([]);
  });

  it('resolves a newer id with the article page and then one POST, and nothing more', async () => {
    const { fetchMock, calls } = fetchAnswering(
      { body: ARTICLE_PAGE },
      { body: batchAnswer(['garturlres', PUBLISHER, 1]) },
    );

    await expect(decodeGoogleNewsLink(ID, { fetch: fetchMock })).resolves.toBe(PUBLISHER);

    expect(calls).toHaveLength(2);
    const [page, batch] = calls;
    // The page is a plain read: no form, no body.
    expect(page.url).toBe(googleNewsArticleUrl(ID));
    expect(page.init.post).toBeUndefined();
    expect(page.init.accept).toBe('text/html');
    // The second is the one POST, to the one endpoint, with what the page said.
    expect(batch.url).toBe(GOOGLE_NEWS_BATCH_URL);
    expect(batch.init.post).toEqual({
      body: batchRequestBody(ID, TIMESTAMP, SIGNATURE),
      contentType: FORM,
    });
  });

  it('caps both answers, and gives both requests a deadline', async () => {
    const { fetchMock, calls } = fetchAnswering(
      { body: ARTICLE_PAGE },
      { body: batchAnswer(['garturlres', PUBLISHER]) },
    );

    await decodeGoogleNewsLink(ID, { fetch: fetchMock });

    expect(calls[0].init.maxBytes).toBe(1024 * 1024);
    expect(calls[1].init.maxBytes).toBe(256 * 1024);
    for (const { init } of calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal.aborted).toBe(false);
    }
    // One deadline for the two together, not one each.
    expect(calls[1].init.signal).toBe(calls[0].init.signal);
  });

  it("uses the caller's deadline when it is given one", async () => {
    const { fetchMock, calls } = fetchAnswering(
      { body: ARTICLE_PAGE },
      { body: batchAnswer(['garturlres', PUBLISHER]) },
    );
    const { signal } = new AbortController();

    await decodeGoogleNewsLink(ID, { fetch: fetchMock, signal });

    expect(calls.map(({ init }) => init.signal)).toEqual([signal, signal]);
  });

  it('resolves the sample story to the Tamil sample, through the simulated reader', async () => {
    const fixtures = createReaderFixtureFetch();
    const asked: [string, boolean][] = [];
    const counting: DiscoverFetch = (url, init) => {
      asked.push([url, init.post !== undefined]);
      return fixtures(url, init);
    };

    await expect(decodeGoogleNewsLink(ID, { fetch: counting })).resolves.toBe(
      READER_SAMPLE.tamilArticle,
    );
    expect(asked).toEqual([
      [googleNewsArticleUrl(ID), false],
      [GOOGLE_NEWS_BATCH_URL, true],
    ]);
  });

  it.each([
    ['the page is missing', [{ status: 404 }], 'page', 1],
    ['the page says slow down', [{ status: 429, body: ARTICLE_PAGE }], 'page', 1],
    [
      'the page is a consent page',
      [{ body: '<html><body>Before you continue</body></html>' }],
      'page',
      1,
    ],
    ['the page is empty', [{ body: '' }], 'page', 1],
    ['the page never arrives', [new Error('ECONNRESET')], 'page', 1],
    ['the answer is a server error', [{ body: ARTICLE_PAGE }, { status: 500 }], 'answer', 2],
    [
      'the answer is refused',
      [{ body: ARTICLE_PAGE }, { status: 400, body: batchAnswer(['garturlres', PUBLISHER]) }],
      'answer',
      2,
    ],
    [
      'the answer is not the shape',
      [{ body: ARTICLE_PAGE }, { body: ')]}\'\n\n[["er"]]' }],
      'answer',
      2,
    ],
    ['the answer is empty', [{ body: ARTICLE_PAGE }, { body: '' }], 'answer', 2],
    [
      'the answer holds a script',
      [{ body: ARTICLE_PAGE }, { body: batchAnswer(['garturlres', 'javascript:alert(1)']) }],
      'answer',
      2,
    ],
    [
      'the answer leads back to Google News',
      [
        { body: ARTICLE_PAGE },
        { body: batchAnswer(['garturlres', `https://news.google.com/rss/articles/${ID}`]) },
      ],
      'answer',
      2,
    ],
    ['the answer never arrives', [{ body: ARTICLE_PAGE }, new Error('ETIMEDOUT')], 'answer', 2],
  ] as [string, Answer[], string, number][])(
    'does not resolve when %s, and never asks again',
    async (_what, answers, reason, requests) => {
      const { fetchMock, calls } = fetchAnswering(...answers);

      await expect(reasonOf(decodeGoogleNewsLink(ID, { fetch: fetchMock }))).resolves.toBe(reason);
      expect(calls).toHaveLength(requests);
    },
  );

  it.each([
    ['nothing', ''],
    ['an id that is too short', 'CBMi'],
    ['an id with a slash', `${ID}/../../x`],
    ['an id with a query', `${ID}?oc=5`],
    ['a whole link', `https://news.google.com/rss/articles/${ID}`],
    ['an id with a space', 'CBMi SAMPLE story'],
    ['an id with a line break', `${ID}\nHost: evil.example`],
  ])('refuses %s as an id, with no request', async (_what, id) => {
    const { fetchMock, calls } = fetchAnswering();

    await expect(reasonOf(decodeGoogleNewsLink(id, { fetch: fetchMock }))).resolves.toBe(
      'not_a_link',
    );
    expect(calls).toEqual([]);
  });

  it('throws its own error, with nothing from Google and no address in it', async () => {
    const { fetchMock } = fetchAnswering({ status: 500, body: 'a secret body' });
    const error = await decodeGoogleNewsLink(ID, { fetch: fetchMock }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(LinkUnresolvedError);
    expect(error).toBeInstanceOf(Error);
    expect((error as LinkUnresolvedError).name).toBe('LinkUnresolvedError');
    expect((error as LinkUnresolvedError).message).toBe('The story link could not be resolved.');
    expect((error as LinkUnresolvedError).message).not.toContain('secret');
    expect((error as LinkUnresolvedError).message).not.toContain(ID);
  });

  it('never asks any host but Google News, whatever the id', async () => {
    const hosts = new Set<string>();
    const watching: DiscoverFetch = async (url) => {
      hosts.add(new URL(url).hostname);
      return { status: 200, body: ARTICLE_PAGE, finalUrl: url };
    };

    for (const id of [ID, 'CBMi-_-_-_-_-_-_', 'AAAAAAAAAAAAAAAA', `${'a'.repeat(2_048)}`]) {
      await decodeGoogleNewsLink(id, { fetch: watching }).catch(() => undefined);
    }

    expect([...hosts]).toEqual([GOOGLE_NEWS_HOST]);
  });
});
