/**
 * Add Hook Title (Sprint 13, Module 09) against an in-memory database and
 * transcript store, through the real captions service (so the words read and
 * the tenancy check are the real ones) and the simulated title writer: the
 * clip's played sentences only, three cleaned titles, free (nothing charged),
 * the throttle, no words, the writer off or failing, and no word or title in
 * any log.
 */
import { HttpException, Logger } from '@nestjs/common';
import {
  createSimulatedModelClient,
  createSnippetWriter,
  HOOK_TEXT_MAX_CHARS,
  type ModelClient,
} from '@postgear/ai-engine';
import type { ClipAsset } from '@postgear/db';
import {
  type ClipDocument,
  createClipDocument,
  emptyTranscript,
  mergeTranscript,
  type Transcript,
  transcriptAssetMeta,
} from '@postgear/video-engine';
import type { AiEngine } from '../../ai/engine/engine.types';
import type { UsageService } from '../../entitlements/usage.service';
import type { RedisService } from '../../redis/redis.service';
import { ClipCaptionStylesRepository } from '../captions/clip-caption-styles.repository';
import { ClipCaptionStylesService } from '../captions/clip-caption-styles.service';
import { ClipCaptionsService } from '../captions/clip-captions.service';
import { ClipItemService } from '../clip/clip-item.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import {
  assetRow,
  clipRow,
  emptyTables,
  type FakeClipDb,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import type { ClipTranscriptStore } from '../transcripts/clip-transcript-store';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { CLIP_HOOK_TITLES_MESSAGES } from './clip-hook-titles.messages';
import { hookTitlesBodySchema } from './clip-hook-titles.schema';
import {
  ClipHookTitlesService,
  HOOK_TITLES_PER_MINUTE,
  hookTextFrom,
} from './clip-hook-titles.service';

let mockDb: FakeClipDb;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const VIDEO = videoRow().id;
const CLIP = clipRow().id;
const OTHER_ORG = 'seed-second-org';
const HEARD_ID = '77777777-7777-4777-8777-777777777777';
const HEARD_KEY = `clips/${TEST_ORG}/${VIDEO}/transcript-${'c'.repeat(32)}.json.gz`;

/** Speech words; `zebra` is said only outside the clip, `walrus` only inside. */
const INSIDE = ['the', 'walrus', 'jump', 'was', 'perfect.'];
const OUTSIDE = ['a', 'zebra', 'ran', 'past', 'us.'];

/** The clip plays 120 s to 150 s of the video. */
function document(fromMs = 120_000, toMs = 150_000): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs, toMs, ratio: '9:16' });
}

/** One word a second from `fromSec`; the clip's seconds say INSIDE, the rest OUTSIDE. */
function listened(fromSec: number, toSec: number): Transcript {
  return mergeTranscript(emptyTranscript('en', 'simulation'), {
    ranges: [{ fromMs: fromSec * 1000, toMs: toSec * 1000 }],
    words: Array.from({ length: toSec - fromSec }, (_, index) => {
      const second = fromSec + index;
      const bank = second >= 120 && second < 150 ? INSIDE : OUTSIDE;
      return {
        start: second * 1000,
        end: second * 1000 + 600,
        text: bank[second % 5] as string,
        sure: 0.9,
      };
    }),
  });
}

/** A fixed-window counter like Redis's, in memory. */
function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    incrementWithTtl: jest.fn(async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    }),
  };
}

interface SetupOptions {
  /** The seconds of the video listened to, or null for none. */
  heard?: [number, number] | null;
  document?: ClipDocument;
  ai?: 'simulation' | 'off' | 'failing' | ModelClient;
}

function setup(options: SetupOptions = {}) {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY', durationMs: 600_000, hasAudio: true }));
  const files = new Map<string, Transcript>();
  const heard = options.heard === undefined ? ([0, 300] as [number, number]) : options.heard;
  if (heard) {
    const transcript = listened(heard[0], heard[1]);
    files.set(HEARD_KEY, transcript);
    tables.assets.push(
      assetRow({
        id: HEARD_ID,
        organizationId: TEST_ORG,
        videoId: VIDEO,
        clipId: null,
        kind: 'TRANSCRIPT',
        key: HEARD_KEY,
        meta: transcriptAssetMeta(transcript),
      } as Partial<ClipAsset>),
    );
  }
  tables.clips.push(clipRow({ document: options.document ?? document() }));
  mockDb = fakeClipDb(tables);

  const store = { read: jest.fn(async (key: string) => files.get(key) ?? null) };
  // Hook titles are free: any call here is a failure of the test.
  const usage = { consume: jest.fn(), reverseAllFor: jest.fn(), reverse: jest.fn() };
  const limits = { assertEnabled: jest.fn(async () => undefined) } as unknown as ClipLimitsGuard;
  const transcripts = new ClipTranscriptsService(
    new ClipVideosRepository(),
    {} as never,
    {} as never,
    limits,
    usage as unknown as UsageService,
    store as unknown as ClipTranscriptStore,
    { state: jest.fn(async () => 'ok') } as never,
  );
  const captions = new ClipCaptionsService(
    Object.create(ClipItemService.prototype) as ClipItemService,
    new ClipVideosRepository(),
    transcripts,
    new ClipCaptionStylesService(new ClipCaptionStylesRepository()),
    store as unknown as ClipTranscriptStore,
    usage as unknown as UsageService,
    limits,
    {} as AiEngine,
  );

  const model: ModelClient =
    typeof options.ai === 'object'
      ? options.ai
      : options.ai === 'failing'
        ? {
            name: 'failing',
            structured: async () => {
              throw Object.assign(new Error('The provider said: walrus jump'), {
                kind: 'unavailable',
              });
            },
            // biome-ignore lint/correctness/useYield: never called.
            chat: async function* () {
              throw new Error('not used');
            },
          }
        : createSimulatedModelClient();
  const writer = createSnippetWriter(model);
  const writeHookTitles = jest.spyOn(writer, 'writeHookTitles');
  const ai = {
    createSnippetWriter: jest.fn(() => (options.ai === 'off' ? null : writer)),
  } as unknown as AiEngine;
  const redis = fakeRedis();
  const service = new ClipHookTitlesService(captions, redis as unknown as RedisService, ai);
  return { service, usage, writeHookTitles, redis };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

let logs: string[];
beforeEach(() => {
  logs = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      logs.push(String(args[0]));
    });
  }
});
afterEach(() => jest.restoreAllMocks());

describe('POST /clips/:clipId/hook-titles', () => {
  it('answers three different, cleaned titles from the words the clip plays, for free', async () => {
    const { service, usage, writeHookTitles } = setup();
    const { titles } = await service.suggest(TEST_ORG, TEST_USER, CLIP);

    expect(titles).toHaveLength(3);
    expect(new Set(titles.map((title) => title.toLowerCase())).size).toBe(3);
    for (const title of titles) {
      expect(title.split(' ').length).toBeLessThanOrEqual(7);
      expect(title).not.toMatch(/["#“”]/);
    }
    expect(titles.join(' ').toLowerCase()).toContain('walrus');

    const sent = writeHookTitles.mock.calls[0]?.[0];
    expect(sent?.language).toBe('English');
    expect(sent?.text).toContain('walrus');
    expect(sent?.text).not.toContain('zebra');
    expect(usage.consume).not.toHaveBeenCalled();
    expect(usage.reverseAllFor).not.toHaveBeenCalled();
  });

  it('sends only the words the clip plays, never the gap between parts or the handles', async () => {
    // Two parts, 120 s to 125 s and 145 s to 150 s: one word a second each.
    const base = document();
    const first = base.segments[0] as ClipDocument['segments'][number];
    const twoParts: ClipDocument = {
      ...base,
      segments: [
        { ...first, sourceOut: 125_000 },
        { ...first, id: 'seg-second', sourceIn: 145_000, sourceOut: 150_000 },
      ],
    };
    const { service, writeHookTitles } = setup({ document: twoParts });
    await service.suggest(TEST_ORG, TEST_USER, CLIP);

    const sent = writeHookTitles.mock.calls[0]?.[0];
    expect(sent?.text.split(' ')).toHaveLength(10);
    expect(sent?.text).not.toContain('zebra');
  });

  it('gives the same titles for the same words (simulation)', async () => {
    const { service } = setup();
    const once = await service.suggest(TEST_ORG, TEST_USER, CLIP);
    const again = await service.suggest(TEST_ORG, TEST_USER, CLIP);
    expect(again).toEqual(once);
  });

  it('cleans what a model answers: quotes, hashtags and long titles', async () => {
    const answers: ModelClient = {
      name: 'messy',
      structured: async <T>() =>
        ({
          hookTitles: [
            '"The walrus jump" #viral',
            '#walrus',
            '1. Nobody believed the walrus could jump that high today',
            'The walrus jump',
            "“It's perfect”",
          ],
        }) as T,
      // biome-ignore lint/correctness/useYield: never called.
      chat: async function* () {
        throw new Error('not used');
      },
    };
    const { service } = setup({ ai: answers });
    expect((await service.suggest(TEST_ORG, TEST_USER, CLIP)).titles).toEqual([
      'The walrus jump',
      'Nobody believed the walrus could jump that',
      "It's perfect",
    ]);
  });

  it('sends whole sentences, at most 1,500 characters', async () => {
    const sentence = 'The walrus jump was perfect.';
    const text = hookTextFrom(Array.from({ length: 200 }, () => sentence));
    expect(text.length).toBeLessThanOrEqual(HOOK_TEXT_MAX_CHARS);
    expect(text.endsWith(sentence)).toBe(true);
    expect(hookTextFrom(['  ', 'One.', 'Two.'])).toBe('One. Two.');
  });

  it('is a plain 404 for another workspace clip, and an unknown id', async () => {
    const { service, writeHookTitles } = setup();
    expect((await refusal(service.suggest(OTHER_ORG, TEST_USER, CLIP))).status).toBe(404);
    expect((await refusal(service.suggest(TEST_ORG, TEST_USER, 'not-a-clip'))).status).toBe(404);
    expect(writeHookTitles).not.toHaveBeenCalled();
  });

  it('refuses a clip with no words heard: 422 with a sentence', async () => {
    for (const heard of [null, [0, 60]] as const) {
      const { service, writeHookTitles } = setup({ heard: heard as [number, number] | null });
      const answer = await refusal(service.suggest(TEST_ORG, TEST_USER, CLIP));
      expect(answer.status).toBe(422);
      expect(answer.body).toEqual({
        message: CLIP_HOOK_TITLES_MESSAGES.NO_WORDS,
        code: 'hook_titles_no_words',
      });
      expect(writeHookTitles).not.toHaveBeenCalled();
    }
  });

  it('throttles the eleventh ask in a minute per workspace (429), others unaffected', async () => {
    const { service, writeHookTitles } = setup();
    for (let ask = 0; ask < HOOK_TITLES_PER_MINUTE; ask += 1) {
      await service.suggest(TEST_ORG, TEST_USER, CLIP);
    }
    const answer = await refusal(service.suggest(TEST_ORG, TEST_USER, CLIP));
    expect(answer.status).toBe(429);
    expect(answer.body).toEqual({
      message: CLIP_HOOK_TITLES_MESSAGES.THROTTLED,
      code: 'hook_titles_throttled',
    });
    expect(writeHookTitles).toHaveBeenCalledTimes(HOOK_TITLES_PER_MINUTE);
    // Another workspace has its own window (its clip lookup is then a 404, not a 429).
    expect((await refusal(service.suggest(OTHER_ORG, TEST_USER, CLIP))).status).toBe(404);
  });

  it('answers 503 with the writer off and 502 when it fails, nothing charged', async () => {
    const off = setup({ ai: 'off' });
    const offAnswer = await refusal(off.service.suggest(TEST_ORG, TEST_USER, CLIP));
    expect(offAnswer.status).toBe(503);
    expect(offAnswer.body.code).toBe('hook_titles_off');

    const failing = setup({ ai: 'failing' });
    const failed = await refusal(failing.service.suggest(TEST_ORG, TEST_USER, CLIP));
    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({
      message: CLIP_HOOK_TITLES_MESSAGES.FAILED,
      code: 'hook_titles_failed',
    });
    expect(failing.usage.consume).not.toHaveBeenCalled();
  });

  it('never logs a word or a title', async () => {
    const { service } = setup();
    const { titles } = await service.suggest(TEST_ORG, TEST_USER, CLIP);
    await refusal(setup({ ai: 'failing' }).service.suggest(TEST_ORG, TEST_USER, CLIP));
    const all = logs.join('\n').toLowerCase();
    expect(logs.length).toBeGreaterThan(0);
    for (const word of [
      'walrus',
      'jump',
      'perfect',
      'zebra',
      ...titles.map((t) => t.toLowerCase()),
    ]) {
      expect(all).not.toContain(word);
    }
  });

  it('takes an empty body, none or an attempt from 0 to 50, and refuses any other key', () => {
    expect(hookTitlesBodySchema.safeParse({}).success).toBe(true);
    expect(hookTitlesBodySchema.safeParse(undefined).success).toBe(true);
    expect(hookTitlesBodySchema.safeParse({ attempt: 0 }).success).toBe(true);
    expect(hookTitlesBodySchema.safeParse({ attempt: 50 }).success).toBe(true);
    for (const attempt of [-1, 51, 1.5, '1']) {
      expect(hookTitlesBodySchema.safeParse({ attempt }).success).toBe(false);
    }
    expect(hookTitlesBodySchema.safeParse({ text: 'my own words' }).success).toBe(false);
  });

  it('passes the attempt on, so Try Again answers three new titles', async () => {
    const { service, writeHookTitles } = setup();
    const first = await service.suggest(TEST_ORG, TEST_USER, CLIP);
    const again = await service.suggest(TEST_ORG, TEST_USER, CLIP, 1);
    expect(writeHookTitles.mock.calls[0]?.[0].attempt).toBe(0);
    expect(writeHookTitles.mock.calls[1]?.[0].attempt).toBe(1);
    expect(again.titles).not.toEqual(first.titles);
  });
});
