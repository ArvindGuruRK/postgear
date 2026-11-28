/**
 * Sprint 13, Module 16 section 2: the API's share of the Clips AI stories'
 * edge cases (section 5 of `docs/new-modules/user-stories-clips-ai.md`) that
 * no older spec proves, and the API half of two forcing switches.
 *
 * - "AI work is queued", as a hand check forces it: `CLIPS_MEDIA_SLOTS=1`
 *   with Find Clips held on the `[simulate:highlights-slow]` sample
 *   (`https://www.twitch.tv/videos/900000008`). A second Find Clips then waits
 *   behind it with a time in minutes, which the web reads as "Waiting for our
 *   turn, about N minutes"; with the default slots it does not wait at all.
 * - `[simulate:model-bad-rows]` typed as the request: the simulated model
 *   answers rows that do not exist, and every one is dropped before a moment
 *   is made (the model half is `packages/ai-engine/src/agents/moments.edge-cases.test.ts`).
 * - Creator copy never says "job": the internal routes of Find Clips, its
 *   still pictures, Follow The Speaker and a run's recipe answer a missing
 *   job with the shared sentence and keep the code `job_not_found`.
 */
import { HttpException, Logger } from '@nestjs/common';
import {
  createSimulatedModelClient,
  createSnippetWriter,
  type MomentPickResult,
} from '@postgear/ai-engine';
import { defaultClipSetup, type TranscriptWord } from '@postgear/video-engine';
import type { AiEngine } from '../ai/engine/engine.types';
import type { EntitlementResolver } from '../entitlements/entitlement-resolver';
import type { UsageService } from '../entitlements/usage.service';
import type { RedisService } from '../redis/redis.service';
import { CLIPS_MESSAGES } from './clips.messages';
import type { ClipFacesService } from './faces/clip-faces.service';
import { ClipFollowService } from './faces/clip-follow.service';
import { ClipMomentsService } from './highlights/clip-moments.service';
import { ClipStillsService } from './highlights/clip-stills.service';
import type { ClipJobsRepository, QueueRow, QueueSnapshot } from './jobs/clip-jobs.repository';
import { roundToMinutes } from './jobs/clip-queue.rules';
import { ClipQueueService } from './jobs/clip-queue.service';
import { ClipRecipeApplierService } from './recipes/clip-recipe-applier.service';
import { TEST_ORG } from './testing/rows';
import type { ClipTranscriptsService } from './transcripts/clip-transcripts.service';
import type { ClipVideosRepository } from './videos/clip-videos.repository';

const JOB = '11111111-1111-4111-8111-111111111111';
const VIDEO = '22222222-2222-4222-8222-222222222222';
const BAD_ROWS = '[simulate:model-bad-rows]';

const mockDb = {
  job: null as Record<string, unknown> | null,
  params: {} as unknown,
};
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    clipJob: { findFirst: jest.fn(async () => mockDb.job) },
    clipHighlightRun: { findFirst: jest.fn(async () => ({ id: 'run-1', params: mockDb.params })) },
    // The run's read charge stands.
    usageEntry: {
      findFirst: jest.fn(async () => ({ id: 'entry-read', units: 3000 })),
      findMany: jest.fn(async () => []),
    },
  },
}));

beforeAll(() => Logger.overrideLogger(false));
beforeEach(() => {
  mockDb.job = null;
  mockDb.params = {};
});

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

// ---- Creator copy: a job that is not there ----------------------------------------------

describe('a job that is not there, on the AI internal routes', () => {
  const NOT_FOUND = { message: CLIPS_MESSAGES.JOB_NOT_FOUND, code: 'job_not_found' };
  const none = {} as never;

  it('is the shared sentence, which never says "job"', () => {
    expect(CLIPS_MESSAGES.JOB_NOT_FOUND).toBe('We could not find this. It may have been removed.');
    expect(CLIPS_MESSAGES.JOB_NOT_FOUND).not.toMatch(/\bjobs?\b/i);
  });

  it.each([
    [
      'Find Clips reading for moments',
      () => new ClipMomentsService(none, none, none, none).pick(JOB, TEST_ORG),
    ],
    [
      'the still pictures check',
      () => new ClipStillsService(none, none).check(JOB, { organizationId: TEST_ORG, bursts: [] }),
    ],
    [
      'Follow The Speaker for a run',
      () => new ClipFollowService(none as ClipFacesService).forRun(JOB, TEST_ORG),
    ],
    [
      "a run's recipe on its clips",
      () =>
        new ClipRecipeApplierService(
          none,
          none,
          none,
          none,
          none,
          none,
          none,
          none,
          none,
        ).applyToRun(TEST_ORG, JOB),
    ],
  ])('%s answers 404 job_not_found with it', async (_name, call) => {
    const answer = await refusal(call());
    expect(answer.status).toBe(404);
    expect(answer.body).toEqual(NOT_FOUND);
  });
});

// ---- [simulate:model-bad-rows] -----------------------------------------------------------

const SENTENCES = [
  'Alright chat, welcome back to the stream, we are live.',
  'Tonight we are going for the speed run record again.',
  'Yesterday we lost it by two seconds, which still hurts.',
  'So let me set up the route real quick.',
  'You know the plan: skip the first bridge, take the tunnel.',
  'Okay, three, two, one, go.',
  'Clean start, we are already ahead of the ghost.',
  'Here comes the tunnel jump, that was so close.',
  'We cleared the whole gap, what a run.',
  'That is the new record, thank you all for watching.',
];

/** Each sentence 5 s long, one every 7 s from 10 s. */
function words(): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  SENTENCES.forEach((sentence, s) => {
    const parts = sentence.split(' ');
    parts.forEach((text, w) => {
      const start = 10_000 + s * 7_000 + Math.round((w * 5_000) / parts.length);
      out.push({
        i: out.length,
        start,
        end: start + Math.round(4_000 / parts.length),
        text,
        sure: 0.9,
      });
    });
  });
  return out;
}

function momentsService(request: string) {
  mockDb.job = { id: JOB, videoId: VIDEO, highlightRunId: 'run-1' };
  mockDb.params = {
    setup: { ...defaultClipSetup(120_000), request },
    listenJobId: null,
    charges: { read: 'entry-read', signals: null },
  };
  const list = words();
  const transcripts = {
    transcriptRow: jest.fn(async () => ({ id: 't', key: 'k', meta: {} })),
    viewOf: jest.fn(async () => ({
      id: 't',
      language: 'en',
      words: list,
      covered: [{ fromMs: 0, toMs: 120_000 }],
    })),
  };
  const videos = { findLive: jest.fn(async () => ({ id: VIDEO, durationMs: 120_000 })) };
  const usage = { reverse: jest.fn(async () => ({ entryId: 'rev', duplicate: false })) };
  const writer = createSnippetWriter(createSimulatedModelClient());
  const pickMoments = jest.spyOn(writer, 'pickMoments');
  const ai = { createSnippetWriter: jest.fn(() => writer) };
  const service = new ClipMomentsService(
    transcripts as unknown as ClipTranscriptsService,
    videos as unknown as ClipVideosRepository,
    usage as unknown as UsageService,
    ai as unknown as AiEngine,
  );
  return { service, pickMoments };
}

describe('[simulate:model-bad-rows] as the request (simulation)', () => {
  it('makes the model answer rows that do not exist, and none of them becomes a moment', async () => {
    const plain = momentsService('');
    const before = await plain.service.pick(JOB, TEST_ORG);

    const forced = momentsService(BAD_ROWS);
    const answer = await forced.service.pick(JOB, TEST_ORG);
    const asked = await (forced.pickMoments.mock.results[0]?.value as Promise<MomentPickResult>);
    const sent = forced.pickMoments.mock.calls[0]?.[0];
    const rowNumbers = new Set(sent?.windows.flat().map((row) => row.n));
    const bad = asked.picks.filter((pick) => !rowNumbers.has(pick.fromRow));
    expect(bad.length).toBeGreaterThan(0);

    // The run still finishes, with fewer moments, each on rows that were sent.
    expect(answer.noSpeech).toBe(false);
    expect(answer.moments.length).toBeGreaterThan(0);
    expect(answer.moments.length).toBeLessThan(before.moments.length);
    for (const moment of answer.moments) {
      expect(rowNumbers.has(moment.fromRow)).toBe(true);
      expect(rowNumbers.has(moment.toRow)).toBe(true);
    }
  });
});

// ---- "AI work is queued" ----------------------------------------------------------------

describe('"AI work is queued", forced with one media slot and the slow Find Clips sample', () => {
  const T0 = new Date('2026-11-28T10:00:00.000Z');
  const TEN_MINUTES = 600_000;

  function row(overrides: Partial<QueueRow> & { id: string }): QueueRow {
    return {
      organizationId: TEST_ORG,
      kind: 'HIGHLIGHTS',
      priority: 'normal',
      createdAt: T0,
      videoId: null,
      clipId: null,
      ...overrides,
    };
  }

  function queue(slots: number | undefined) {
    const snapshot: QueueSnapshot = {
      // Find Clips on another video, pressed while the slow sample's run holds the slot.
      waiting: [row({ id: 'mine', videoId: 'video-b', createdAt: new Date(T0.getTime() + 5_000) })],
      holding: [
        {
          ...row({ id: 'slow-sample', videoId: 'video-900000008' }),
          status: 'RUNNING',
          progress: 0,
        },
      ],
      lastServed: new Map(),
      clipped: false,
    };
    const repository = {
      queueSnapshot: jest.fn(async (cls: string) =>
        cls === 'media'
          ? snapshot
          : { waiting: [], holding: [], lastServed: new Map(), clipped: false },
      ),
      inputsOf: jest.fn(async () => new Map()),
      lengths: jest.fn(async (videoIds: string[]) => ({
        videos: new Map(
          videoIds.map((id) => [id, { organizationId: TEST_ORG, durationMs: TEN_MINUTES }]),
        ),
        clips: new Map(),
      })),
    };
    const config = {
      get: jest.fn((key: string) => (key === 'CLIPS_MEDIA_SLOTS' ? slots : undefined)),
    };
    const memory = new Map<string, string>();
    const redis = {
      get: async (key: string) => memory.get(key) ?? null,
      set: async (key: string, value: string) => void memory.set(key, value),
    };
    return new ClipQueueService(
      repository as unknown as ClipJobsRepository,
      { get: jest.fn(async () => 2) } as unknown as EntitlementResolver,
      redis as unknown as RedisService,
      config as never,
    );
  }

  it('waits behind the held run with a time in whole minutes', async () => {
    const estimate = await queue(1).estimate('HIGHLIGHTS', TEST_ORG, {
      jobId: 'mine',
      now: new Date(T0.getTime() + 10_000),
    });
    expect(estimate?.position).toBe(0);
    // A ten minute video at the Find Clips pace before any run finished: 100 s, so "about 2 minutes".
    expect(estimate?.aboutSeconds).toBe(roundToMinutes(100));
    expect(estimate?.aboutSeconds).toBeGreaterThanOrEqual(60);
  });

  it('with the default slots it does not wait at all', async () => {
    const estimate = await queue(undefined).estimate('HIGHLIGHTS', TEST_ORG, {
      jobId: 'mine',
      now: new Date(T0.getTime() + 10_000),
    });
    expect(estimate).toEqual({ position: 0, aboutSeconds: 0 });
  });
});
