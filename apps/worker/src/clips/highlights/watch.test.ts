/**
 * Look For Action's steps (Sprint 13, Module 06) with the stream sample's
 * recorded tracks and a hand-made motion file: the bursts become clips, the
 * still check's sentence lands on its clip, a failed motion measure gives
 * the step's minutes back, and every still and state file is gone at the end.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { gunzipSignalsFile, type SignalProducers } from '@postgear/media-tools';
import type { ClipCheckStillsBody, ClipStillVerdict } from '@postgear/scheduling';
import {
  decodeSignalsFile,
  defaultClipSetup,
  type MotionBurst,
  type SignalsFile,
  type SignalTrack,
} from '@postgear/video-engine';
import { allWatchKeys, highlightsSignalsKey, watchKeys } from '../keys';
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
import { gatherHighlights, type HighlightsRun } from './highlights.run';
import {
  ACTION_FAIL_MARKER,
  actionCandidates,
  finishWatching,
  lookForAction,
  STILL_WIDTH,
  startWatching,
} from './watch';

const RUN_ID = 'cccccccc-dddd-4eee-8fff-000000000000';
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
) as { signals: unknown };
const recorded: SignalsFile = decodeSignalsFile(JSON.stringify(fixture.signals));
const DURATION_MS = recorded.durationMs;
const SAMPLES = Math.ceil(DURATION_MS / 500);
/** A quiet burst at 205 s, away from every cut. */
const BURST_SEC = 205;

function recordedTrack(name: SignalTrack['name']): SignalTrack {
  const track = recorded.tracks.find((candidate) => candidate.name === name);
  if (!track) throw new Error(`the fixture has no ${name} track`);
  return track;
}

function producers(): SignalProducers {
  return {
    loudness: jest.fn(async () => recordedTrack('loudness')),
    scene: jest.fn(async () => recordedTrack('scene')),
    chat: jest.fn(async () => recordedTrack('chat')),
    chatEnabled: true,
  };
}

/** A calm picture with one burst of movement. */
function motionFileBytes(): Buffer {
  const values = Array.from({ length: SAMPLES }, (_, i) =>
    i >= BURST_SEC * 2 && i < BURST_SEC * 2 + 6 ? 48 : 3 + (i % 3) * 0.5,
  );
  return gzipSync(
    Buffer.from(
      JSON.stringify({
        version: 1,
        producer: 'simulation',
        ranges: [{ fromMs: 0, toMs: DURATION_MS }],
        sampleRateHz: 2,
        values,
      }),
    ),
  );
}

function asset(kind: AssetRow['kind'], key: string): AssetRow {
  return {
    id: `asset-${kind}`,
    kind,
    key,
    bytes: 10,
    videoId: VIDEO_ID,
    clipId: null,
    meta: {},
    createdAt: NOW,
  };
}

let dirs: string[] = [];

async function setup(options: { vision?: boolean; title?: string } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pg-watch-'));
  dirs.push(dir);
  const rows = new FakeRows();
  rows.clips.clear();
  const video = videoRow({
    title: options.title ?? 'Stream Sample',
    durationMs: DURATION_MS,
    hasAudio: true,
    status: 'READY',
  });
  rows.videos.set(VIDEO_ID, video);
  rows.assets.push(asset('ANALYSIS_AUDIO', AUDIO_KEY), asset('PROXY', PROXY_KEY));
  rows.jobs.set(
    JOB_ID,
    jobRow({
      id: JOB_ID,
      kind: 'HIGHLIGHTS',
      status: 'RUNNING',
      input: { videoId: VIDEO_ID, runId: RUN_ID },
    }),
  );
  const storage = new FakePrivateStorage();
  storage.objects.set(AUDIO_KEY, Buffer.from('wav'));
  storage.objects.set(PROXY_KEY, Buffer.from('mp4'));
  const progress = fakeProgress();
  const checkStills = jest.fn(
    async (_job: string, body: ClipCheckStillsBody): Promise<{ verdicts: ClipStillVerdict[] }> => ({
      verdicts: body.bursts.map(() => ({
        notable: true,
        kind: 'crash_or_fall',
        sure: 0.9,
        line: 'A shape flips over and crashes.',
      })),
    }),
  );
  const reverseCharges = jest.fn(async () => ({ reversed: 1 }));
  const pickMoments = jest.fn(async () => ({ moments: [], noSpeech: false, asked: false }));
  const run: HighlightsRun = {
    jobId: JOB_ID,
    organizationId: ORG,
    input: { videoId: VIDEO_ID, runId: RUN_ID },
    run: {
      id: RUN_ID,
      organizationId: ORG,
      videoId: VIDEO_ID,
      status: 'RUNNING',
      createdById: 'user-1',
      params: {
        setup: { ...defaultClipSetup(DURATION_MS), action: true },
        listenJobId: null,
        charges: { read: 'entry-1', signals: null, action: 'entry-2' },
        actionVision: options.vision ?? false,
      },
    },
    video,
    link: {
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '900000001',
      width: 1280,
      height: 720,
    },
    dir,
    signal: new AbortController().signal,
    producers: producers(),
    privateStorage: storage,
    rows,
    progress: progress.progress,
    heartbeat: () => undefined,
    now: () => NOW,
    simulated: true,
    internal: { pickMoments, checkStills, reverseCharges },
  };
  return { run, rows, storage, checkStills, reverseCharges };
}

/** Steps 1 to 3 as the workflow runs them, with the motion file in place of Python. */
async function watchUntilLook(made: Awaited<ReturnType<typeof setup>>, motionFailed = false) {
  const { run, storage } = made;
  const gathered = await gatherHighlights(run);
  const started = await startWatching(run, gathered, defaultClipSetupWithAction());
  let motionKey: string | null = null;
  if (started.motion && !motionFailed) {
    motionKey = watchKeys.motion(ORG, VIDEO_ID, JOB_ID);
    storage.objects.set(motionKey, motionFileBytes());
  }
  const look = await lookForAction(run, { motionKey, motionFailed });
  return { started, look };
}

function defaultClipSetupWithAction() {
  return { ...defaultClipSetup(DURATION_MS), action: true };
}

/** The stills Python would cut, stored at their keys. */
function cutStills(storage: FakePrivateStorage, count: number): string[] {
  return Array.from({ length: count }, (_, n) => {
    const key = watchKeys.still(ORG, VIDEO_ID, JOB_ID, n);
    storage.objects.set(key, Buffer.from([0xff, 0xd8, 0xff, n]));
    return key;
  });
}

function leftovers(storage: FakePrivateStorage): string[] {
  const watch = new Set(allWatchKeys(ORG, VIDEO_ID, JOB_ID));
  return [...storage.objects.keys()].filter((key) => watch.has(key));
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

describe('Look For Action without the still check', () => {
  it('measures the chosen stretch, finds the burst, keeps it as a clip, deletes every watch file', async () => {
    const made = await setup();
    const finish = jest.spyOn(made.rows, 'finishHighlights');
    const { started, look } = await watchUntilLook(made);
    expect(started.motion).toMatchObject({
      proxyKey: PROXY_KEY,
      durationMs: DURATION_MS,
      ranges: [{ fromMs: 0, toMs: DURATION_MS }],
      sampleFps: 2,
      simulation: { sample: 'stream', force: null },
    });
    expect(look.stills).toBeNull();

    const outcome = await finishWatching(made.run, null);
    expect(outcome.finished).toBe(true);
    const clips = [...made.rows.clips.values()];
    const action = clips.filter((clip) => clip.reasons?.includes('sudden_movement'));
    expect(action.length).toBeGreaterThan(0);
    expect(action.every((clip) => clip.meta === undefined)).toBe(true);
    expect(made.checkStills).not.toHaveBeenCalled();
    expect(made.reverseCharges).not.toHaveBeenCalled();
    expect(leftovers(made.storage)).toEqual([]);

    const output = finish.mock.calls[0]?.[0].output as { ai?: { watched?: boolean } };
    expect(output.ai?.watched).toBe(true);
    // The motion track is stored with the others, for the next run to reuse.
    const signals = made.storage.objects.get(highlightsSignalsKey(ORG, VIDEO_ID, JOB_ID));
    const file = await gunzipSignalsFile(signals as Buffer);
    expect(file.tracks.map((track) => track.name)).toContain('motion');
  });

  it('a stored motion track covering the stretch is not measured again', async () => {
    const first = await setup();
    await watchUntilLook(first);
    await finishWatching(first.run, null);

    const second = await setup();
    second.rows.assets.push(...first.rows.assets.filter((row) => row.kind === 'SIGNALS'));
    for (const [key, body] of first.storage.objects) second.storage.objects.set(key, body);
    const gathered = await gatherHighlights(second.run);
    const started = await startWatching(second.run, gathered, defaultClipSetupWithAction());
    expect(started.motion).toBeNull();
  });

  it('a failed motion measure gives Look For Action back and still finishes', async () => {
    const made = await setup({ title: `Stream Sample ${ACTION_FAIL_MARKER}` });
    const { started } = await watchUntilLook(made, true);
    expect(started.motion?.simulation).toEqual({ sample: 'stream', force: 'fail' });
    const outcome = await finishWatching(made.run, null);
    expect(outcome.finished).toBe(true);
    expect(made.reverseCharges).toHaveBeenCalledWith(JOB_ID, {
      organizationId: ORG,
      step: 'action',
    });
    const clips = [...made.rows.clips.values()];
    expect(clips.some((clip) => clip.reasons?.includes('sudden_movement'))).toBe(false);
    expect(leftovers(made.storage)).toEqual([]);
  });
});

describe('Look For Action with the still check', () => {
  it('asks four stills a burst, puts the sentence on its clip, and deletes the stills', async () => {
    const made = await setup({ vision: true });
    const { look } = await watchUntilLook(made);
    expect(look.stills?.width).toBe(STILL_WIDTH);
    const count = look.stills?.momentsMs.length ?? 0;
    expect(count).toBeGreaterThan(0);
    expect(count % 4).toBe(0);
    const keys = cutStills(made.storage, count);

    await finishWatching(made.run, keys);
    const body = made.checkStills.mock.calls[0]?.[1];
    expect(body?.bursts.map((burst) => burst.stillKeys)).toEqual(
      Array.from({ length: count / 4 }, (_, i) => keys.slice(i * 4, i * 4 + 4)),
    );
    const seen = [...made.rows.clips.values()].filter((clip) => clip.meta?.seen);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.meta?.seen).toBe('A shape flips over and crashes.');
    expect(seen[0]?.reasons).toContain('something_unexpected');
    for (const key of keys) expect(made.storage.objects.has(key)).toBe(false);
    expect(leftovers(made.storage)).toEqual([]);
  });

  it('a still check that fails leaves the bursts unchecked, and the run finishes', async () => {
    const made = await setup({ vision: true });
    made.checkStills.mockRejectedValueOnce(new Error('model down'));
    const { look } = await watchUntilLook(made);
    const keys = cutStills(made.storage, look.stills?.momentsMs.length ?? 0);
    const outcome = await finishWatching(made.run, keys);
    expect(outcome.finished).toBe(true);
    const clips = [...made.rows.clips.values()];
    expect(clips.some((clip) => clip.reasons?.includes('sudden_movement'))).toBe(true);
    expect(clips.some((clip) => clip.meta?.seen)).toBe(false);
    expect(leftovers(made.storage)).toEqual([]);
  });

  it('stills that did not all come back are not sent to the check', async () => {
    const made = await setup({ vision: true });
    await watchUntilLook(made);
    await finishWatching(made.run, cutStills(made.storage, 3));
    expect(made.checkStills).not.toHaveBeenCalled();
    expect(leftovers(made.storage)).toEqual([]);
  });
});

describe('actionCandidates', () => {
  const burst = (peakSec: number, score: number): MotionBurst => ({
    fromMs: peakSec * 1000 - 500,
    toMs: peakSec * 1000 + 1_500,
    peakMs: peakSec * 1000,
    strength: 10,
    withSound: false,
    score,
  });
  const setupOf = { length: 'auto' as const, range: { fromMs: 0, toMs: 600_000 } };

  it('drops what the model found nothing in, keeps the sentence, weighs unchecked a little less', () => {
    const verdicts: Array<ClipStillVerdict | null> = [
      { notable: true, kind: 'surprise', sure: 0.9, line: 'The picture bursts.' },
      { notable: false, kind: 'nothing', sure: 0.8, line: '' },
      null,
    ];
    const out = actionCandidates(
      [burst(60, 80), burst(120, 80), burst(200, 80), burst(300, 80)],
      verdicts,
      setupOf,
    );
    expect(out.map((candidate) => [candidate.peakMs, candidate.reason, candidate.seen])).toEqual([
      [60_000, 'something_unexpected', 'The picture bursts.'],
      [200_000, 'sudden_movement', null],
      [300_000, 'sudden_movement', null],
    ]);
    expect(out[0]?.score).toBe(80);
    expect(out[1]?.score).toBe(64);
  });
});
