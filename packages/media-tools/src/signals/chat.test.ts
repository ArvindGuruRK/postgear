/**
 * The chat producer against recorded pages only: no test (and no
 * development run) ever calls Twitch. The pages are hand-written in the
 * shape TwitchDownloader reads (research 06 section 5.1).
 */
import { chatMessageTotal } from '@postgear/video-engine';
import {
  CHAT_MAX_PAGES,
  type ChatRequest,
  createTwitchChatSource,
  produceChat,
  reactionWeight,
  readChatPage,
  recordedChatSource,
  TWITCH_CHAT_QUERY_HASH,
  TWITCH_GQL_URL,
} from './chat';

const REQUEST: ChatRequest = {
  platform: 'twitch',
  kind: 'past_stream',
  externalId: '123456789',
  durationMs: 600_000,
};

type Edge = { sec: number; text?: string; emote?: boolean; author?: string };

/** One answer page as Twitch's web player gets it. */
function page(edges: Edge[], options: { next?: boolean; cursorBase?: string } = {}) {
  return [
    {
      data: {
        video: {
          id: '123456789',
          comments: {
            edges: edges.map((edge, index) => ({
              cursor: `${options.cursorBase ?? 'c'}${index}`,
              node: {
                id: `m${index}`,
                commenter: { id: 'u1', login: edge.author ?? 'someone', displayName: 'Someone' },
                contentOffsetSeconds: edge.sec,
                message: {
                  fragments: [
                    {
                      text: edge.text ?? 'hello there',
                      emote: edge.emote ? { emoteID: '25' } : null,
                    },
                  ],
                },
              },
            })),
            pageInfo: { hasNextPage: options.next ?? false, hasPreviousPage: false },
          },
        },
      },
    },
  ];
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch that answers the given bodies in turn and records what it was asked. */
function recordedFetch(answers: Array<Response | Error>) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
    });
    const next = answers.shift();
    if (!next) throw new Error('no more recorded pages');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch, calls };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('reactionWeight', () => {
  it('weighs reaction words, the clip phrases and emotes at 1.5, anything else at 1', () => {
    expect(reactionWeight('KEKW that was wild', false)).toBe(1.5);
    expect(reactionWeight('someone CLIP IT', false)).toBe(1.5);
    expect(reactionWeight('pog!!!', false)).toBe(1.5);
    expect(reactionWeight('hello there', false)).toBe(1);
    expect(reactionWeight('wow', false)).toBe(1);
    // Whole words only: "clipboard" is not "clip", "kappapride" is not "kappa".
    expect(reactionWeight('my clipboard', false)).toBe(1);
    expect(reactionWeight('', true)).toBe(1.5);
  });
});

describe('readChatPage', () => {
  it('keeps the time and a weight, nothing else', () => {
    const read = readChatPage(
      page([{ sec: 12.5, text: 'LUL', author: 'secret_name' }, { sec: 13 }], { next: true }),
    );
    expect(read.messages).toEqual([
      { offsetMs: 12_500, weight: 1.5 },
      { offsetMs: 13_000, weight: 1 },
    ]);
    expect(read.cursor).toBe('c1');
    expect(read.hasNextPage).toBe(true);
    const text = JSON.stringify(read);
    expect(text).not.toContain('secret_name');
    expect(text).not.toContain('LUL');
  });

  it('skips a message with no usable time', () => {
    const body = page([{ sec: 5 }]);
    (
      body[0]?.data.video.comments.edges[0]?.node as { contentOffsetSeconds: unknown }
    ).contentOffsetSeconds = 'x';
    expect(readChatPage(body).messages).toEqual([]);
  });

  it('refuses a deleted video and a page with no comments', () => {
    expect(() => readChatPage([{ data: { video: null } }])).toThrow('video_gone');
    expect(() => readChatPage([{ data: { video: { comments: null } } }])).toThrow('no_comments');
    expect(() => readChatPage({})).toThrow('video_gone');
  });
});

describe('createTwitchChatSource (recorded pages)', () => {
  it('pages one at a time with the cursor until the last page, and asks the documented way', async () => {
    const { fetch, calls } = recordedFetch([
      response(page([{ sec: 1 }, { sec: 2 }], { next: true, cursorBase: 'a' })),
      response(page([{ sec: 3, text: 'W' }], { next: true, cursorBase: 'b' })),
      response(page([{ sec: 4 }], { next: false, cursorBase: 'c' })),
    ]);
    const source = createTwitchChatSource({ fetch });
    const messages = await source.messages(REQUEST);
    expect(messages).toEqual([
      { offsetMs: 1_000, weight: 1 },
      { offsetMs: 2_000, weight: 1 },
      { offsetMs: 3_000, weight: 1.5 },
      { offsetMs: 4_000, weight: 1 },
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url).toBe(TWITCH_GQL_URL);
    expect(calls[0]?.body).toEqual([
      {
        operationName: 'VideoCommentsByOffsetOrCursor',
        variables: { videoID: '123456789', contentOffsetSeconds: 0 },
        extensions: { persistedQuery: { version: 1, sha256Hash: TWITCH_CHAT_QUERY_HASH } },
      },
    ]);
    const bodyOf = (index: number) => calls[index]?.body as Array<{ variables: unknown }>;
    expect(bodyOf(1)[0]?.variables).toEqual({
      videoID: '123456789',
      cursor: 'a1',
    });
    expect(bodyOf(2)[0]?.variables).toEqual({
      videoID: '123456789',
      cursor: 'b0',
    });
  });

  it('uses the query id from the switch when one is given', async () => {
    const { fetch, calls } = recordedFetch([response(page([{ sec: 1 }]))]);
    await createTwitchChatSource({ fetch, queryHash: 'f'.repeat(64) }).messages(REQUEST);
    const sent = calls[0]?.body as Array<{
      extensions: { persistedQuery: { sha256Hash: string } };
    }>;
    expect(sent[0]?.extensions.persistedQuery.sha256Hash).toBe('f'.repeat(64));
  });

  it('an error mid-way gives null, logs one line, and is not retried', async () => {
    const { fetch } = recordedFetch([
      response(page([{ sec: 1 }], { next: true })),
      response({ error: 'Service Unavailable' }, 503),
      response(page([{ sec: 2 }])),
    ]);
    await expect(createTwitchChatSource({ fetch }).messages(REQUEST)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('status_503');
  });

  it('a refused query (Twitch changed its id) gives null', async () => {
    const { fetch } = recordedFetch([
      response([{ errors: [{ message: 'PersistedQueryNotFound' }] }]),
    ]);
    await expect(createTwitchChatSource({ fetch }).messages(REQUEST)).resolves.toBeNull();
    expect(warn.mock.calls[0]?.[0]).toContain('query_refused');
  });

  it('chat replay off (no messages at all) gives null', async () => {
    const { fetch } = recordedFetch([response(page([]))]);
    await expect(createTwitchChatSource({ fetch }).messages(REQUEST)).resolves.toBeNull();
    expect(warn.mock.calls[0]?.[0]).toContain('empty');
  });

  it('a deleted video, a network failure and a page that is not JSON give null', async () => {
    for (const answer of [
      response([{ data: { video: null } }]),
      new TypeError('fetch failed'),
      new Response('<html>', { status: 200 }),
    ]) {
      const { fetch } = recordedFetch([answer]);
      await expect(createTwitchChatSource({ fetch }).messages(REQUEST)).resolves.toBeNull();
    }
  });

  it('stops at the page and time caps and keeps what it has', async () => {
    const endless = jest.fn(async () => response(page([{ sec: 1 }], { next: true })));
    const capped = await createTwitchChatSource({ fetch: endless, maxPages: 3 }).messages(REQUEST);
    expect(endless).toHaveBeenCalledTimes(3);
    expect(capped).toHaveLength(3);
    expect(CHAT_MAX_PAGES).toBe(3_000);

    let clock = 0;
    const slow = jest.fn(async () => {
      clock += 60_000;
      return response(page([{ sec: 1 }], { next: true }));
    });
    const timed = await createTwitchChatSource({
      fetch: slow,
      now: () => clock,
      maxMs: 150_000,
    }).messages(REQUEST);
    expect(slow).toHaveBeenCalledTimes(3);
    expect(timed).toHaveLength(3);
  });

  it('asks nothing for anything but Twitch', async () => {
    const { fetch } = recordedFetch([]);
    const source = createTwitchChatSource({ fetch });
    await expect(source.messages({ ...REQUEST, platform: 'kick' })).resolves.toBeNull();
    await expect(source.messages({ ...REQUEST, externalId: null })).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('produceChat', () => {
  it('turns messages into a rate track that holds no text', async () => {
    const { fetch } = recordedFetch([
      response(
        page([
          { sec: 10, text: 'secret words', author: 'secret_name' },
          { sec: 10.2, text: 'KEKW' },
        ]),
      ),
    ]);
    const track = await produceChat(createTwitchChatSource({ fetch }), REQUEST);
    expect(track?.name).toBe('chat');
    expect(track?.unit).toBe('messages_per_second');
    expect(track?.values.every((value) => value === null || typeof value === 'number')).toBe(true);
    if (!track) throw new Error('no track');
    expect(chatMessageTotal(track)).toBeCloseTo(2.5, 5);
    const text = JSON.stringify(track);
    expect(text).not.toMatch(/secret|KEKW/);
  });

  it('reads chat only for a Twitch past broadcast, and none without a source', async () => {
    const source = { messages: jest.fn(async () => [{ offsetMs: 1_000, weight: 1 }]) };
    expect(await produceChat(source, { ...REQUEST, kind: 'clip' })).toBeNull();
    expect(await produceChat(source, { ...REQUEST, platform: 'youtube' })).toBeNull();
    expect(await produceChat(null, REQUEST)).toBeNull();
    expect(source.messages).not.toHaveBeenCalled();
  });
});

describe('recordedChatSource', () => {
  it("answers the stream sample's recorded chat for its Twitch link, and nothing else", async () => {
    const source = recordedChatSource();
    const messages = await source.messages({ ...REQUEST, externalId: '900000001' });
    expect(messages?.length).toBeGreaterThan(400);
    expect(await source.messages({ ...REQUEST, externalId: '900000099' })).toBeNull();
    expect((await source.messages({ ...REQUEST, externalId: '900000008' }))?.length).toBe(
      messages?.length,
    );
    // The Kick twin plays the same sample, but chat for Kick is out of scope (Module 16).
    expect(
      await source.messages({
        ...REQUEST,
        platform: 'kick',
        externalId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toBeNull();
  });
});
