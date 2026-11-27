/**
 * One Find Clips run with the stream sample's recorded tracks standing in for
 * the producers (their own tests run the real FFmpeg): reuse of stored
 * tracks, a producer failing on its own, the replace rule, the forcing
 * markers, and a run whose job was closed meanwhile.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { gunzipSignalsFile, gzipSignalsFile, type SignalProducers } from '@postgear/media-tools';
import type { ClipPickedMoment } from '@postgear/scheduling';
import {
  decodeSignalsFile,
  defaultClipSetup,
  type SignalsFile,
  type SignalTrack,
} from '@postgear/video-engine';
import { ClipStepError, classifyClipError } from '../failures';
import { highlightsSignalsKey } from '../keys';
import type { AssetRow } from '../rows';
import {
  FakePrivateStorage,
  FakeRows,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import {
  FAIL_MARKER,
  type HighlightsRun,
  highlightClips,
  highlightTitle,
  runHighlights,
  SLOW_MARKER,
  readRunSetup,
} from './highlights.run';

const RUN_ID = 'cccccccc-dddd-4eee-8fff-000000000000';
const SECOND_JOB = '22222222-3333-4444-8555-666666666666';
const SECOND_RUN = 'dddddddd-eeee-4fff-8000-111111111111';
const AUDIO_KEY = `clips/${ORG}/${VIDEO_ID}/analysis.wav`;
const PROXY_KEY = `clips/${ORG}/${VIDEO_ID}/proxy.mp4`;
const NOW = new Date('2026-11-19T09:00:00Z');

const fixture = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      '../../../../../packages/video-engine/src/signals/fixtures/stream.signals.json',
    ),
    'utf8',
  ),
) as { moments: Array<{ startSec: number; endSec: number }>; signals: unknown };
const recorded: SignalsFile = decodeSignalsFile(JSON.stringify(fixture.signals));
const DURATION_MS = recorded.durationMs;

function recordedTrack(name: SignalTrack['name']): SignalTrack {
  const track = recorded.tracks.find((candidate) => candidate.name === name);
  if (!track) throw new Error(`the fixture has no ${name} track`);
  return track;
}

/** Producers answering the recorded tracks, each a spy. */
function producers(overrides: Partial<SignalProducers> = {}) {
  return {
    loudness: jest.fn(async () => recordedTrack('loudness')),
    scene: jest.fn(async () => recordedTrack('scene')),
    chat: jest.fn(async () => recordedTrack('chat')),
    chatEnabled: true,
    ...overrides,
  } satisfies SignalProducers;
}

function asset(kind: AssetRow['kind'], key: string, id = `asset-${kind}`): AssetRow {
  return { id, kind, key, bytes: 10, videoId: VIDEO_ID, clipId: null, meta: {}, createdAt: NOW };
}

interface Setup {
  rows: FakeRows;
  storage: FakePrivateStorage;
  dir: string;
  progress: ReturnType<typeof fakeProgress>;
  controller: AbortController;
  make(overrides?: Partial<HighlightsRun>): HighlightsRun;
}

let dirs: string[] = [];

async function setup(
  options: { title?: string; hasAudio?: boolean; jobId?: string; runId?: string } = {},
): Promise<Setup> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pg-highlights-'));
  dirs.push(dir);
  const rows = new FakeRows();
  rows.clips.clear();
  const video = videoRow({
    title: options.title ?? 'Stream Sample',
    durationMs: DURATION_MS,
    hasAudio: options.hasAudio ?? true,
    status: 'READY',
  });
  rows.videos.set(VIDEO_ID, video);
  rows.links.set(VIDEO_ID, {
    platform: 'twitch',
    kind: 'past_stream',
    externalId: '900000001',
    width: 1280,
    height: 720,
  });
  rows.assets.push(asset('ANALYSIS_AUDIO', AUDIO_KEY), asset('PROXY', PROXY_KEY));
  const storage = new FakePrivateStorage();
  storage.objects.set(AUDIO_KEY, Buffer.from('wav'));
  storage.objects.set(PROXY_KEY, Buffer.from('mp4'));
  addRun(rows, options.jobId ?? JOB_ID, options.runId ?? RUN_ID);
  const progress = fakeProgress();
  const controller = new AbortController();

  const make = (overrides: Partial<HighlightsRun> = {}): HighlightsRun => {
    const jobId = overrides.jobId ?? options.jobId ?? JOB_ID;
    const runId = overrides.input?.runId ?? options.runId ?? RUN_ID;
    return {
      jobId,
      organizationId: ORG,
      input: { videoId: VIDEO_ID, runId },
      run: {
        id: runId,
        organizationId: ORG,
        videoId: VIDEO_ID,
        status: 'RUNNING',
        createdById: 'user-1',
      },
      video: rows.videos.get(VIDEO_ID) ?? video,
      link: rows.links.get(VIDEO_ID) ?? {
        platform: 'upload',
        kind: 'upload',
        externalId: null,
        width: null,
        height: null,
      },
      dir,
      signal: controller.signal,
      producers: producers(),
      privateStorage: storage,
      rows,
      progress: progress.progress,
      heartbeat: () => undefined,
      now: () => NOW,
      simulated: true,
      ...overrides,
    };
  };
  return { rows, storage, dir, progress, controller, make };
}

function addRun(rows: FakeRows, jobId: string, runId: string) {
  rows.jobs.set(
    jobId,
    jobRow({
      id: jobId,
      kind: 'HIGHLIGHTS',
      status: 'RUNNING',
      input: { videoId: VIDEO_ID, runId },
    }),
  );
  rows.runs.set(runId, {
    id: runId,
    organizationId: ORG,
    videoId: VIDEO_ID,
    status: 'RUNNING',
    createdById: 'user-1',
  });
}

/** The clips of a video, best first (newest createdAt first, as the API lists them). */
function aiClips(rows: FakeRows) {
  return [...rows.clips.values()]
    .filter((clip) => clip.origin === 'AI_SIGNALS')
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

function rangeOf(clip: { document?: unknown }) {
  const document = clip.document as { segments: Array<{ sourceIn: number; sourceOut: number }> };
  const segment = document.segments[0];
  return segment ? { fromMs: segment.sourceIn, toMs: segment.sourceOut } : null;
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('runHighlights with a setup (Sprint 13, Module 05)', () => {
  const LISTEN_JOB = '99999999-aaaa-4bbb-8ccc-000000000001';
  const HEARD = '99999999-aaaa-4bbb-8ccc-000000000002';
  function setupParams(overrides: Record<string, unknown> = {}) {
    return {
      setup: { ...defaultClipSetup(DURATION_MS), ratio: '1:1', ...overrides },
      listenJobId: null,
      charges: { read: 'entry-1', signals: null },
    };
  }
  const moment = (
    fromMs: number,
    toMs: number,
    extra: Partial<ClipPickedMoment> = {},
  ): ClipPickedMoment => ({
    fromMs,
    toMs,
    fromRow: 1,
    toRow: 3,
    parts: { hook: 16, standsAlone: 16, payoff: 12, clarity: 15, shareable: 10 },
    score: 69,
    funny: false,
    matchesRequest: false,
    title: 'The tunnel jump',
    ...extra,
  });

  it('reads the transcript after listening and makes titled transcript clips in the chosen shape', async () => {
    const { make, rows } = await setup();
    rows.jobs.set(LISTEN_JOB, jobRow({ id: LISTEN_JOB, kind: 'TRANSCRIBE', status: 'RUNNING' }));
    const finish = jest.spyOn(rows, 'finishHighlights');
    const sleeps: number[] = [];
    const pickMoments = jest.fn(async () => ({
      moments: [moment(30_000, 62_000, { matchesRequest: true })],
      noSpeech: false,
      asked: true,
    }));
    const base = make();
    const outcome = await runHighlights(
      make({
        run: {
          ...base.run,
          params: { ...setupParams({ request: 'tunnel' }), listenJobId: LISTEN_JOB },
        },
        internal: { pickMoments },
        sleep: async (ms) => {
          sleeps.push(ms);
          // The listening job ends while the run waits for it.
          rows.jobs.set(LISTEN_JOB, jobRow({ id: LISTEN_JOB, kind: 'TRANSCRIBE', status: 'DONE' }));
        },
      }),
    );
    expect(outcome.finished).toBe(true);
    expect(sleeps.length).toBeGreaterThan(0);
    expect(pickMoments).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
    const made = [...rows.clips.values()].filter((clip) => clip.origin === 'AI_TRANSCRIPT');
    expect(made).toHaveLength(1);
    expect(made[0]?.title).toBe('The tunnel jump');
    expect((made[0]?.document as { canvas: { ratio: string } } | undefined)?.canvas.ratio).toBe(
      '1:1',
    );
    expect(made[0]?.reasons?.[0]).toBe('matches_request');
    expect(rangeOf(made[0] ?? {})).toEqual({ fromMs: 30_000, toMs: 62_000 });
    expect(finish.mock.calls[0]?.[0].output).toMatchObject({
      ai: { read: true, noSpeech: false, asked: true, matched: 1 },
    });
  });

  it('skips listening when it was all listened to already', async () => {
    const { make, rows } = await setup();
    const lookups = jest.spyOn(rows, 'job');
    const base = make();
    await runHighlights(
      make({
        run: { ...base.run, params: setupParams() },
        internal: { pickMoments: async () => ({ moments: [], noSpeech: false, asked: false }) },
      }),
    );
    expect(lookups).not.toHaveBeenCalledWith(ORG, LISTEN_JOB);
  });

  it('falls back to the signals alone when no speech was heard, and says so', async () => {
    const { make, rows } = await setup();
    const finish = jest.spyOn(rows, 'finishHighlights');
    const base = make();
    await runHighlights(
      make({
        run: { ...base.run, params: setupParams() },
        internal: { pickMoments: async () => ({ moments: [], noSpeech: true, asked: false }) },
      }),
    );
    expect(finish.mock.calls[0]?.[0].output).toMatchObject({ ai: { read: false, noSpeech: true } });
  });

  it('puts captions on the new clips when the setup asks and the video was listened to', async () => {
    const { make, rows } = await setup();
    rows.assets.push({
      ...asset('TRANSCRIPT', `clips/${ORG}/${VIDEO_ID}/transcript.json.gz`, HEARD),
      meta: {
        language: 'en',
        model: 'simulation',
        source: 'listened',
        covered: [{ fromMs: 0, toMs: DURATION_MS }],
        words: 10,
        fixes: [],
      },
    } as AssetRow);
    const base = make();
    await runHighlights(
      make({
        run: { ...base.run, params: setupParams({ captions: { on: true, styleId: 'marker' } }) },
        internal: {
          pickMoments: async () => ({
            moments: [moment(30_000, 62_000)],
            noSpeech: false,
            asked: false,
          }),
        },
      }),
    );
    const made = [...rows.clips.values()].find((clip) => clip.origin === 'AI_TRANSCRIPT');
    const tracks =
      (made?.document as { tracks: Array<Record<string, unknown>> } | undefined)?.tracks ?? [];
    expect(tracks.find((track) => track.kind === 'captions')).toMatchObject({
      transcriptAssetId: HEARD,
      styleId: 'marker',
      language: 'en',
    });
  });

  describe('Follow The Speaker (Module 08)', () => {
    const picked = async () => ({
      moments: [moment(30_000, 62_000), moment(120_000, 150_000)],
      noSpeech: false,
      asked: false,
    });
    const answer = {
      follow: true,
      marked: 2,
      faces: { ready: 0, running: 2, failed: 0 },
      facesOff: false,
    };

    it('tells the API once the clips are written, when the setup follows', async () => {
      const { make, rows } = await setup();
      const finish = jest.spyOn(rows, 'finishHighlights');
      const followSpeaker = jest.fn(async () => answer);
      const base = make();
      const outcome = await runHighlights(
        make({
          run: { ...base.run, params: setupParams({ follow: true }) },
          internal: { pickMoments: picked, followSpeaker },
        }),
      );
      expect(outcome.finished).toBe(true);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(followSpeaker).toHaveBeenCalledTimes(1);
      expect(followSpeaker).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
      // Only after the clips are written.
      expect(finish.mock.invocationCallOrder[0]).toBeLessThan(
        followSpeaker.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('never asks when the setup does not follow, or for a run with no setup', async () => {
      const { make } = await setup();
      const followSpeaker = jest.fn(async () => answer);
      const base = make();
      await runHighlights(
        make({
          run: { ...base.run, params: setupParams() },
          internal: { pickMoments: picked, followSpeaker },
        }),
      );
      await runHighlights(make({ internal: { pickMoments: picked, followSpeaker } }));
      expect(followSpeaker).not.toHaveBeenCalled();
    });

    it('a failure is silent: the run still finishes, tried twice on a hiccup, once when refused', async () => {
      const { make } = await setup();
      const hiccup = jest.fn(async () => {
        throw new ClipStepError('tool_failed', { retryable: true });
      });
      const base = make();
      const params = setupParams({ follow: true });
      const outcome = await runHighlights(
        make({
          run: { ...base.run, params },
          internal: { pickMoments: picked, followSpeaker: hiccup },
        }),
      );
      expect(outcome.finished).toBe(true);
      expect(hiccup).toHaveBeenCalledTimes(2);

      const refused = jest.fn(async () => {
        throw new ClipStepError('tool_failed', { retryable: false });
      });
      const again = await setup({ jobId: '11111111-aaaa-4bbb-8ccc-000000000009' });
      const second = again.make();
      expect(
        (
          await runHighlights(
            again.make({
              run: { ...second.run, params },
              internal: { pickMoments: picked, followSpeaker: refused },
            }),
          )
        ).finished,
      ).toBe(true);
      expect(refused).toHaveBeenCalledTimes(1);
      const warned = (console.warn as jest.Mock).mock.calls.map((call) => String(call[0]));
      expect(warned.some((line) => line.includes('clips.highlights.follow_failed'))).toBe(true);
    });
  });

  describe('the recipe (Module 10)', () => {
    const picked = async () => ({
      moments: [moment(30_000, 62_000), moment(120_000, 150_000)],
      noSpeech: false,
      asked: false,
    });

    it.each([
      ['a recipe', { recipeId: 'starter-social-edit' }],
      ['silences', { silences: true }],
      ['a hook title', { hookTitle: true }],
      ['a brand kit', { brandKitId: '99999999-aaaa-4bbb-8ccc-000000000003' }],
    ])('asks the API once, after the clips are written, for a setup with %s', async (_, extra) => {
      const { make, rows } = await setup();
      const finish = jest.spyOn(rows, 'finishHighlights');
      const applyRecipe = jest.fn(async () => ({ applied: 2, skipped: 0 }));
      const base = make();
      const outcome = await runHighlights(
        make({
          run: { ...base.run, params: setupParams(extra) },
          internal: { pickMoments: picked, applyRecipe },
        }),
      );
      expect(outcome.finished).toBe(true);
      expect(applyRecipe).toHaveBeenCalledTimes(1);
      expect(applyRecipe).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
      expect(finish.mock.invocationCallOrder[0]).toBeLessThan(
        applyRecipe.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('comes right after Follow The Speaker', async () => {
      const { make } = await setup();
      const followSpeaker = jest.fn(async () => ({
        follow: true,
        marked: 2,
        faces: { ready: 0, running: 2, failed: 0 },
        facesOff: false,
      }));
      const applyRecipe = jest.fn(async () => ({ applied: 2, skipped: 0 }));
      const base = make();
      await runHighlights(
        make({
          run: { ...base.run, params: setupParams({ follow: true, silences: true }) },
          internal: { pickMoments: picked, followSpeaker, applyRecipe },
        }),
      );
      expect(followSpeaker.mock.invocationCallOrder[0]).toBeLessThan(
        applyRecipe.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('never asks for a plain setup, or a run with no setup', async () => {
      const { make } = await setup();
      const applyRecipe = jest.fn(async () => ({ applied: 0, skipped: 0 }));
      const base = make();
      await runHighlights(
        make({
          run: { ...base.run, params: setupParams() },
          internal: { pickMoments: picked, applyRecipe },
        }),
      );
      await runHighlights(make({ internal: { pickMoments: picked, applyRecipe } }));
      expect(applyRecipe).not.toHaveBeenCalled();
    });

    it('a failure never fails the run: tried twice on a hiccup, logged with ids only', async () => {
      const { make } = await setup();
      const hiccup = jest.fn(async () => {
        throw new ClipStepError('tool_failed', { retryable: true });
      });
      const base = make();
      const outcome = await runHighlights(
        make({
          run: { ...base.run, params: setupParams({ recipeId: 'starter-reframe' }) },
          internal: { pickMoments: picked, applyRecipe: hiccup },
        }),
      );
      expect(outcome.finished).toBe(true);
      expect(hiccup).toHaveBeenCalledTimes(2);
      const warned = (console.warn as jest.Mock).mock.calls.map((call) => String(call[0]));
      expect(warned.some((line) => line.includes('clips.highlights.recipe_failed'))).toBe(true);
    });
  });

  it('reads a run with no setup as Sprint 12 did (Quick Find)', () => {
    expect(readRunSetup(undefined)).toBeNull();
    expect(readRunSetup({ tuning: 'signals-v1' })).toBeNull();
    expect(readRunSetup(setupParams())?.setup.ratio).toBe('1:1');
  });
});

describe('runHighlights', () => {
  it('measures every track, stores them, and finishes with one clip per moment, best first', async () => {
    const { rows, storage, progress, make } = await setup();
    const run = make();
    const outcome = await runHighlights(run);

    expect(outcome).toEqual(
      expect.objectContaining({
        finished: true,
        found: 7,
        measured: ['loudness', 'scene', 'chat'],
      }),
    );
    expect(outcome.used).toEqual(expect.arrayContaining(['loudness', 'scene', 'chat']));
    expect(run.producers.loudness).toHaveBeenCalledWith(
      expect.objectContaining({
        audioFile: path.join(run.dir, 'analysis.wav'),
        durationMs: DURATION_MS,
      }),
    );
    expect(run.producers.chat).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'twitch', kind: 'past_stream', externalId: '900000001' }),
    );

    // The merged file sits under the run's key, and the asset row points at it.
    const key = highlightsSignalsKey(ORG, VIDEO_ID, JOB_ID);
    const stored = await gunzipSignalsFile(storage.objects.get(key) as Buffer);
    expect(stored.tracks.map((track) => track.name)).toEqual(['loudness', 'scene', 'chat']);
    expect(rows.assets.filter((row) => row.kind === 'SIGNALS')).toEqual([
      expect.objectContaining({
        id: JOB_ID,
        key,
        meta: expect.objectContaining({ durationMs: DURATION_MS }),
      }),
    ]);

    // Seven clips, each over one planned moment, best first, titled in order.
    const clips = aiClips(rows);
    expect(clips).toHaveLength(7);
    expect(clips.map((clip) => clip.title)).toEqual(
      Array.from({ length: 7 }, (_, index) => `Stream Sample ${index + 1}`),
    );
    const scores = clips.map((clip) => clip.score ?? 0);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    for (const clip of clips) {
      const range = rangeOf(clip);
      expect(range).not.toBeNull();
      const covered = fixture.moments.filter(
        (moment) =>
          range && moment.startSec * 1000 < range.toMs && moment.endSec * 1000 > range.fromMs,
      );
      expect(covered).toHaveLength(1);
      expect(clip.reasons?.length).toBeGreaterThan(0);
      expect(clip.status).toBe('NEW');
      expect(clip.highlightRunId).toBe(RUN_ID);
    }

    expect(rows.jobs.get(JOB_ID)?.status).toBe('DONE');
    expect(rows.runs.get(RUN_ID)).toEqual(expect.objectContaining({ status: 'DONE', found: 7 }));
    const stages = progress.reports.map((report) => report.stage);
    expect([...new Set(stages)]).toEqual(['loudness', 'scenes', 'chat', 'scoring']);
    const values = progress.reports.map((report) => report.progress);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it('a second run reuses the stored tracks (no producer runs) and picks the same moments', async () => {
    const { rows, make } = await setup();
    await runHighlights(make());
    const first = aiClips(rows).map(rangeOf);

    addRun(rows, SECOND_JOB, SECOND_RUN);
    const again = make({ jobId: SECOND_JOB, input: { videoId: VIDEO_ID, runId: SECOND_RUN } });
    const outcome = await runHighlights(again);

    expect(again.producers.loudness).not.toHaveBeenCalled();
    expect(again.producers.scene).not.toHaveBeenCalled();
    expect(again.producers.chat).not.toHaveBeenCalled();
    expect(outcome.measured).toEqual([]);
    // Nothing new to store: the first run's file stays the video's one.
    expect(rows.assets.filter((row) => row.kind === 'SIGNALS').map((row) => row.id)).toEqual([
      JOB_ID,
    ]);
    // The unopened clips of the first run were replaced by the same picks.
    const second = aiClips(rows);
    expect(second.every((clip) => clip.highlightRunId === SECOND_RUN)).toBe(true);
    expect(second.map(rangeOf)).toEqual(first);
  });

  it('replaces only AI clips nobody opened, exported or sent; every other clip stays', async () => {
    const { rows, make } = await setup();
    const base = { organizationId: ORG, videoId: VIDEO_ID, origin: 'AI_SIGNALS' as const };
    rows.clips.set('ai-new', { ...base, id: 'ai-new', title: 'Old 1', status: 'NEW' });
    rows.clips.set('ai-opened', { ...base, id: 'ai-opened', title: 'Old 2', status: 'DRAFT' });
    rows.clips.set('ai-hidden', { ...base, id: 'ai-hidden', title: 'Old 3', status: 'HIDDEN' });
    rows.clips.set('ai-exported', {
      ...base,
      id: 'ai-exported',
      title: 'Old 4',
      status: 'NEW',
      exported: true,
    });
    rows.clips.set('ai-sent', {
      ...base,
      id: 'ai-sent',
      title: 'Old 5',
      status: 'NEW',
      sent: true,
    });
    rows.clips.set('manual', {
      ...base,
      id: 'manual',
      title: 'Mine',
      origin: 'MANUAL',
      status: 'NEW',
    });

    await runHighlights(make());
    const ids = [...rows.clips.keys()];
    expect(ids).not.toContain('ai-new');
    expect(ids).toEqual(
      expect.arrayContaining(['ai-opened', 'ai-hidden', 'ai-exported', 'ai-sent', 'manual']),
    );
  });

  it('never adds a twin of an AI clip somebody kept: the run still counts it as found', async () => {
    const { rows, make } = await setup();
    await runHighlights(make());
    const [best, , , , , , last] = aiClips(rows);
    // Somebody opened the best pick and hid the last one.
    if (best) best.status = 'DRAFT';
    if (last) last.status = 'HIDDEN';

    addRun(rows, SECOND_JOB, SECOND_RUN);
    await runHighlights(
      make({ jobId: SECOND_JOB, input: { videoId: VIDEO_ID, runId: SECOND_RUN } }),
    );

    const after = aiClips(rows);
    const fresh = after.filter((clip) => clip.highlightRunId === SECOND_RUN);
    expect(fresh).toHaveLength(5);
    expect(after.map(rangeOf)).toHaveLength(7);
    expect(new Set(after.map((clip) => JSON.stringify(rangeOf(clip)))).size).toBe(7);
    // The fresh ones keep their rank in the title, so no name repeats a kept one.
    expect(fresh.map((clip) => clip.title)).not.toContain(best?.title);
    expect(fresh.map((clip) => clip.title)).not.toContain(last?.title);
    expect(rows.runs.get(SECOND_RUN)?.found).toBe(7);
  });

  it('a producer that fails is left out and the run goes on with the rest', async () => {
    const { rows, make } = await setup();
    const run = make({
      producers: producers({
        scene: jest.fn(async () => {
          throw new Error('ffmpeg broke');
        }),
      }),
    });
    const outcome = await runHighlights(run);
    expect(outcome.finished).toBe(true);
    expect(outcome.measured).toEqual(['loudness', 'chat']);
    expect(outcome.used).not.toContain('scene');
    expect(rows.jobs.get(JOB_ID)?.status).toBe('DONE');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('clips.highlights.producer_failed'),
    );
  });

  it('fails (so the minutes come back) only when every producer that ran failed', async () => {
    const { rows, storage, make } = await setup();
    rows.links.set(VIDEO_ID, {
      platform: 'upload',
      kind: 'upload',
      externalId: null,
      width: 1280,
      height: 720,
    });
    const broken = async () => {
      throw new Error('broken');
    };
    const run = make({
      producers: producers({ loudness: jest.fn(broken), scene: jest.fn(broken) }),
    });

    await expect(runHighlights(run)).rejects.toEqual(new ClipStepError('highlights_failed'));
    expect(run.producers.chat).not.toHaveBeenCalled();
    expect([...storage.objects.keys()].some((key) => key.includes('signals'))).toBe(false);
    expect(aiClips(rows)).toHaveLength(0);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('RUNNING');
  });

  it('a video with no sound is scored on its picture alone', async () => {
    const { make } = await setup({ hasAudio: false });
    const run = make();
    const outcome = await runHighlights(run);
    expect(run.producers.loudness).not.toHaveBeenCalled();
    expect(outcome.measured).toEqual(['scene', 'chat']);
    expect(outcome.finished).toBe(true);
  });

  it('reads chat only for a Twitch past stream with a chat source bound', async () => {
    const youtube = await setup();
    youtube.rows.links.set(VIDEO_ID, {
      platform: 'youtube',
      kind: 'video',
      externalId: 'abc',
      width: 1280,
      height: 720,
    });
    const onYoutube = youtube.make();
    await runHighlights(onYoutube);
    expect(onYoutube.producers.chat).not.toHaveBeenCalled();

    const off = await setup();
    const noSource = off.make({ producers: producers({ chatEnabled: false }) });
    await runHighlights(noSource);
    expect(noSource.producers.chat).not.toHaveBeenCalled();
  });

  it('chat that cannot be read is not a failure', async () => {
    const { make } = await setup();
    const run = make({ producers: producers({ chat: jest.fn(async () => null) }) });
    const outcome = await runHighlights(run);
    expect(outcome.finished).toBe(true);
    expect(outcome.used).not.toContain('chat');
  });

  it('a stored file that does not read is ignored and the tracks are measured again', async () => {
    const { rows, storage, make } = await setup();
    rows.assets.push(asset('SIGNALS', 'clips/broken.json.gz', 'asset-broken'));
    storage.objects.set('clips/broken.json.gz', Buffer.from('not gzip'));
    const run = make();
    const outcome = await runHighlights(run);
    expect(run.producers.loudness).toHaveBeenCalledTimes(1);
    expect(outcome.measured).toEqual(['loudness', 'scene', 'chat']);
    expect(storage.deleted).toContain('clips/broken.json.gz');
  });

  it('a stored file gone from storage is measured again', async () => {
    const { rows, make } = await setup();
    rows.assets.push(asset('SIGNALS', 'clips/gone.json.gz', 'asset-gone'));
    const run = make();
    const outcome = await runHighlights(run);
    expect(outcome.finished).toBe(true);
    expect(outcome.measured).toEqual(['loudness', 'scene', 'chat']);
  });

  it('a storage hiccup reading the stored file fails the step, to be tried again, and keeps it', async () => {
    const { rows, storage, make } = await setup();
    const storedKey = 'clips/stored.json.gz';
    const partial: SignalsFile = { ...recorded, tracks: [recordedTrack('loudness')] };
    storage.objects.set(storedKey, await gzipSignalsFile(partial));
    rows.assets.push(asset('SIGNALS', storedKey, 'asset-stored'));
    const getToFile = storage.getToFile.bind(storage);
    const hiccup = new Error('storage unavailable');
    jest.spyOn(storage, 'getToFile').mockImplementation(async (key, file) => {
      if (key === storedKey) throw hiccup;
      return getToFile(key, file);
    });

    const run = make();
    const failed = await runHighlights(run).catch((error: unknown) => error);
    expect(failed).toBe(hiccup);
    expect(classifyClipError(failed)).toEqual({ code: 'tool_failed', retryable: true });
    // Nothing measured, nothing written: the stored file and its row stay for the retry.
    expect(run.producers.loudness).not.toHaveBeenCalled();
    expect(storage.objects.has(storedKey)).toBe(true);
    expect(storage.deleted).not.toContain(storedKey);
    expect(storage.objects.has(highlightsSignalsKey(ORG, VIDEO_ID, JOB_ID))).toBe(false);
    expect(aiClips(rows)).toHaveLength(0);
  });

  it('keeps a stored track of another name when it measures the rest', async () => {
    const { rows, storage, make } = await setup();
    const storedKey = 'clips/stored.json.gz';
    const partial: SignalsFile = { ...recorded, tracks: [recordedTrack('loudness')] };
    storage.objects.set(storedKey, await gzipSignalsFile(partial));
    rows.assets.push(asset('SIGNALS', storedKey, 'asset-stored'));

    const run = make();
    const outcome = await runHighlights(run);
    expect(run.producers.loudness).not.toHaveBeenCalled();
    expect(outcome.measured).toEqual(['scene', 'chat']);
    const merged = await gunzipSignalsFile(
      storage.objects.get(highlightsSignalsKey(ORG, VIDEO_ID, JOB_ID)) as Buffer,
    );
    expect(merged.tracks.map((track) => track.name)).toEqual(['loudness', 'scene', 'chat']);
    // The new file replaces the old row and its object.
    expect(rows.assets.filter((row) => row.kind === 'SIGNALS').map((row) => row.id)).toEqual([
      JOB_ID,
    ]);
    expect(storage.deleted).toContain(storedKey);
  });

  it('the fail marker fails the scoring step under simulation, and is ignored otherwise', async () => {
    const forced = await setup({ title: `Sample ${FAIL_MARKER}` });
    await expect(runHighlights(forced.make())).rejects.toEqual(
      new ClipStepError('highlights_failed'),
    );
    expect(aiClips(forced.rows)).toHaveLength(0);

    const real = await setup({ title: `Sample ${FAIL_MARKER}` });
    const outcome = await runHighlights(real.make({ simulated: false }));
    expect(outcome.finished).toBe(true);
  });

  it('the slow marker holds the scoring step until Cancel, which writes nothing', async () => {
    const { rows, storage, controller, make } = await setup({ title: `Sample ${SLOW_MARKER}` });
    let naps = 0;
    const run = make({
      sleep: async () => {
        naps += 1;
        if (naps === 3) controller.abort();
      },
    });
    await expect(runHighlights(run)).rejects.toEqual(new ClipStepError('cancelled'));
    expect(naps).toBe(3);
    expect(aiClips(rows)).toHaveLength(0);
    expect(storage.objects.has(highlightsSignalsKey(ORG, VIDEO_ID, JOB_ID))).toBe(false);
  });

  it('a cancel inside a producer is a cancel, not a failure that is skipped', async () => {
    const { controller, make } = await setup();
    const run = make({
      producers: producers({
        loudness: jest.fn(async () => {
          controller.abort();
          throw new Error('aborted');
        }),
      }),
    });
    await expect(runHighlights(run)).rejects.toEqual(new ClipStepError('cancelled'));
    expect(run.producers.scene).not.toHaveBeenCalled();
  });

  it('a job closed meanwhile keeps nothing: no clips, and its signals file is deleted', async () => {
    const { rows, storage, make } = await setup();
    const job = rows.jobs.get(JOB_ID);
    if (job) job.status = 'CANCELLED';
    const outcome = await runHighlights(make());
    expect(outcome.finished).toBe(false);
    expect(aiClips(rows)).toHaveLength(0);
    expect(storage.deleted).toContain(highlightsSignalsKey(ORG, VIDEO_ID, JOB_ID));
    expect(storage.objects.has(highlightsSignalsKey(ORG, VIDEO_ID, JOB_ID))).toBe(false);
  });

  it('a video with no length fails at once', async () => {
    const { rows, make } = await setup();
    const video = rows.videos.get(VIDEO_ID);
    if (video) video.durationMs = null;
    await expect(runHighlights(make())).rejects.toEqual(new ClipStepError('highlights_failed'));
  });
});

describe('highlight clips', () => {
  it('titles each clip "{video title} {n}", within 200 characters', () => {
    expect(highlightTitle('Stream Sample', 3)).toBe('Stream Sample 3');
    expect(highlightTitle('   ', 1)).toBe('Untitled Video 1');
    const long = highlightTitle('x'.repeat(300), 12);
    expect(long).toHaveLength(200);
    expect(long.endsWith(' 12')).toBe(true);
  });

  it('builds a 9:16 document of each range, framed for the source', () => {
    const [clip] = highlightClips({ id: VIDEO_ID, title: 'Talk' }, { width: 1280, height: 720 }, [
      { fromMs: 10_000, toMs: 40_000, score: 80, reasons: ['loud'], peakMs: 20_000 },
    ]);
    expect(clip).toEqual(
      expect.objectContaining({
        title: 'Talk 1',
        ratio: '9:16',
        durationMs: 30_000,
        score: 80,
        reasons: ['loud'],
      }),
    );
    expect(rangeOf(clip as { document: unknown })).toEqual({ fromMs: 10_000, toMs: 40_000 });
  });
});
